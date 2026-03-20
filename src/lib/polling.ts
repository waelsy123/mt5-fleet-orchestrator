import { prisma } from "./prisma";
import { VpsClient } from "./vps-client";
import { notifyTelegram } from "./notify";

const POLL_INTERVAL_MS = 10_000;
const SNAPSHOT_EVERY_N_TICKS = 30; // every 30 ticks = 5 minutes
const BACKOFF_AFTER_FAILURES = 3; // back off after 3 consecutive failures
const BACKOFF_EVERY_N_TICKS = 6; // when backed off, poll every 6th tick (60s)
const SNAPSHOT_RETENTION_DAYS = 60;
const CLEANUP_EVERY_N_TICKS = 8640; // every 8640 ticks = ~24 hours

let running = false;
let tickCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Track previous state to only notify on transitions
const prevVpsOnline = new Map<string, boolean>();
const prevAccountConnected = new Map<string, boolean>();

// Track consecutive poll failures per VPS for health-aware backoff
const consecutiveFailures = new Map<string, number>();

export function startPolling() {
  if (running) return;
  running = true;
  console.log("[polling] Started background polling every 10s");

  pollTimer = setInterval(async () => {
    if (!running) return;
    await pollAll();
  }, POLL_INTERVAL_MS);
}

export function stopPolling() {
  running = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollAll() {
  tickCount++;
  const shouldSnapshot = tickCount % SNAPSHOT_EVERY_N_TICKS === 0;

  // Cleanup old snapshots every ~1 hour
  if (tickCount % CLEANUP_EVERY_N_TICKS === 0) {
    cleanupOldSnapshots();
  }

  let vpsList;
  try {
    vpsList = await prisma.vps.findMany({
      where: {
        status: { in: ["ONLINE", "OFFLINE", "PENDING"] },
      },
      include: { accounts: true },
    });
  } catch (err) {
    console.error("[polling] Failed to load VPS list:", err);
    return;
  }

  if (vpsList.length === 0) return;

  const results = await Promise.allSettled(
    vpsList.map((vps) => pollSingleVps(vps, shouldSnapshot))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      console.error(
        `[polling] Unhandled error for VPS ${vpsList[i].name}:`,
        result.reason
      );
    }
  }
}

async function cleanupOldSnapshots() {
  try {
    const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await prisma.accountSnapshot.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    if (count > 0) {
      console.log(`[polling] Cleaned up ${count} snapshots older than ${SNAPSHOT_RETENTION_DAYS} days`);
    }
  } catch (err) {
    console.error("[polling] Snapshot cleanup failed:", err);
  }
}

async function pollSingleVps(
  vps: {
    id: string;
    name: string;
    ip: string;
    apiPort: number;
    accounts: { id: string; login: string; server: string }[];
  },
  shouldSnapshot: boolean
) {
  // Health-aware backoff: skip this tick if VPS has failed too many times
  const failures = consecutiveFailures.get(vps.id) ?? 0;
  if (failures >= BACKOFF_AFTER_FAILURES && tickCount % BACKOFF_EVERY_N_TICKS !== 0) {
    return; // backed off — only poll every 60s
  }

  const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });

  // Step 1: Ping via /accounts (fast, no EA calls)
  let reachable = false;
  try {
    const accounts = await client.getAccounts();
    reachable = true;

    // Ensure all accounts from VPS registry exist in our DB
    for (const acct of Object.values(accounts)) {
      await prisma.account.upsert({
        where: {
          vpsId_server_login: {
            vpsId: vps.id,
            server: acct.server,
            login: acct.login,
          },
        },
        create: {
          vpsId: vps.id,
          login: acct.login,
          server: acct.server,
        },
        update: {},
      });
    }

    await prisma.vps.update({
      where: { id: vps.id },
      data: { status: "ONLINE", lastSeen: new Date(), lastError: null },
    });
    consecutiveFailures.set(vps.id, 0);
    // Notify recovery
    if (prevVpsOnline.get(vps.id) === false) {
      notifyTelegram(`🟢 <b>VPS Back Online</b>\n<code>${vps.name}</code> (${vps.ip})`);
    }
    prevVpsOnline.set(vps.id, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newFailures = (consecutiveFailures.get(vps.id) ?? 0) + 1;
    consecutiveFailures.set(vps.id, newFailures);
    await prisma.vps.update({
      where: { id: vps.id },
      data: { status: "OFFLINE", lastError: message },
    });
    // Notify only on transition to offline
    if (prevVpsOnline.get(vps.id) !== false) {
      prevVpsOnline.set(vps.id, false);
      notifyTelegram(`🔴 <b>VPS Offline</b>\n<code>${vps.name}</code> (${vps.ip})\n${message}`);
    }
    if (newFailures === BACKOFF_AFTER_FAILURES) {
      console.log(`[polling] ${vps.name}: ${newFailures} consecutive failures, backing off to every 60s`);
    }
    return;
  }

  // Step 2: Try to get detailed stats via /dashboard/data (slow, calls EA)
  if (reachable) {
    try {
      const data = await client.getDashboardData();

      for (const acct of data.accounts) {
        const upserted = await prisma.account.upsert({
          where: {
            vpsId_server_login: {
              vpsId: vps.id,
              server: acct.server,
              login: String(acct.login),
            },
          },
          update: {
            broker: acct.broker || undefined,
            balance: acct.balance,
            equity: acct.equity,
            freeMargin: acct.free_margin,
            profit: acct.profit,
            connected: acct.connected,
            lastSynced: new Date(),
            // Promote SETUP → ACTIVE once connected with balance
            ...(acct.connected && acct.balance > 0 ? { status: "ACTIVE" } : {}),
          },
          create: {
            vpsId: vps.id,
            login: String(acct.login),
            server: acct.server,
            broker: acct.broker || null,
            balance: acct.balance,
            equity: acct.equity,
            freeMargin: acct.free_margin,
            profit: acct.profit,
            connected: acct.connected,
            lastSynced: new Date(),
            status: acct.connected && acct.balance > 0 ? "ACTIVE" : "SETUP",
          },
        });

        // Notify on account disconnect/reconnect transitions
        const acctKey = `${vps.id}|${acct.server}|${acct.login}`;
        const wasConnected = prevAccountConnected.get(acctKey);
        if (wasConnected === true && !acct.connected) {
          notifyTelegram(`⚠️ <b>Account Disconnected</b>\n<code>${acct.login}@${acct.server}</code>\nVPS: ${vps.name}`);
        } else if (wasConnected === false && acct.connected) {
          notifyTelegram(`✅ <b>Account Reconnected</b>\n<code>${acct.login}@${acct.server}</code>\nVPS: ${vps.name}`);
        }
        prevAccountConnected.set(acctKey, acct.connected);

        if (shouldSnapshot) {
          await prisma.accountSnapshot.create({
            data: {
              accountId: upserted.id,
              balance: acct.balance,
              equity: acct.equity,
              profit: acct.profit,
              positions: acct.positions,
            },
          });
        }
      }
    } catch (err) {
      // Dashboard data failed but VPS is still reachable — don't mark offline
      console.error(`[polling] Dashboard data failed for ${vps.name}:`, err);
    }
  }
}
