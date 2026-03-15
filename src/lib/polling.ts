import { prisma } from "./prisma";
import { VpsClient } from "./vps-client";

const POLL_INTERVAL_MS = 30_000;
const SNAPSHOT_EVERY_N_TICKS = 10; // every 10 ticks = 5 minutes

let running = false;
let tickCount = 0;

export function startPolling() {
  if (running) return;
  running = true;
  console.log("[polling] Started background polling every 30s");

  setInterval(async () => {
    if (!running) return;
    await pollAll();
  }, POLL_INTERVAL_MS);
}

export function stopPolling() {
  running = false;
}

async function pollAll() {
  tickCount++;
  const shouldSnapshot = tickCount % SNAPSHOT_EVERY_N_TICKS === 0;

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.vps.update({
      where: { id: vps.id },
      data: { status: "OFFLINE", lastError: message },
    });
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
          },
        });

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
