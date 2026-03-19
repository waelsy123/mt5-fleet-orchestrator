import { VpsClient } from "./vps-client";
import { prisma } from "./prisma";
import { notifyTelegram } from "./notify";

interface TrackedPosition {
  symbol: string;
  type: string;
  volume: string;
}

interface LogEntry {
  time: string;
  action: string;
  detail: string;
}

type MirrorStatus = "synced" | "failed" | "closing" | "closed" | "close_failed";

interface MirrorState {
  status: MirrorStatus;
  error?: string;
  targetTicket?: number; // position ticket on the target account
}

export type CopyMode = "follow" | "opposite";

export interface TargetAccount {
  vpsId: string;
  server: string;
  login: string;
  mode: CopyMode;
  volumeMult: number;
}

interface TargetState {
  account: TargetAccount;
  mode: CopyMode;
  mirrors: Record<string, MirrorState>;
  lastError: string | null;
  lastSyncedAt: number | null;
  log: LogEntry[];
}

export interface CopierConfig {
  sourceVpsId: string;
  sourceServer: string;
  sourceLogin: string;
  targets: TargetAccount[];
}

function targetKey(t: TargetAccount) {
  return `${t.vpsId}|${t.server}|${t.login}`;
}

function now() {
  return new Date().toTimeString().slice(0, 8);
}

// Shared VpsClient cache across all sessions
const clientCache: Map<string, VpsClient> = new Map();

async function getClient(vpsId: string): Promise<VpsClient> {
  const cached = clientCache.get(vpsId);
  if (cached) return cached;
  const vps = await prisma.vps.findUniqueOrThrow({ where: { id: vpsId } });
  const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });
  clientCache.set(vpsId, client);
  return client;
}

async function persistSession(id: string, config: CopierConfig | null, running: boolean) {
  try {
    if (!config || !running) {
      await prisma.copierSession.delete({ where: { id } }).catch(() => {});
    } else {
      await prisma.copierSession.upsert({
        where: { id },
        create: {
          id,
          running: true,
          sourceVpsId: config.sourceVpsId,
          sourceServer: config.sourceServer,
          sourceLogin: config.sourceLogin,
          targets: JSON.parse(JSON.stringify(config.targets)),
        },
        update: {
          running: true,
          sourceVpsId: config.sourceVpsId,
          sourceServer: config.sourceServer,
          sourceLogin: config.sourceLogin,
          targets: JSON.parse(JSON.stringify(config.targets)),
        },
      });
    }
  } catch (e) {
    console.error(`[COPIER:${id}] Failed to persist session:`, e);
  }
}

class CopierSession {
  readonly id: string;
  running = false;
  config: CopierConfig | null = null;
  private sourcePositions: Record<string, TrackedPosition> = {};
  private preExistingTickets: Set<string> = new Set(); // tickets that existed at session start — never copy these
  private targetStates: Map<string, TargetState> = new Map();
  private globalLog: LogEntry[] = [];
  private maxLog = 200;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(id: string) {
    this.id = id;
  }

  private sourceLabel(): string {
    if (!this.config) return "unknown";
    return `${this.config.sourceLogin}@${this.config.sourceServer}`;
  }

  private log(action: string, detail: string) {
    const entry = { time: now(), action, detail };
    this.globalLog.push(entry);
    if (this.globalLog.length > this.maxLog) {
      this.globalLog = this.globalLog.slice(-this.maxLog);
    }
    if (action === "ERROR" || action === "FAIL") {
      notifyTelegram(`🚨 <b>Copier ${action}</b>\nSource: <code>${this.sourceLabel()}</code>\n${detail}`);
    }
    console.log(`[COPIER:${this.id}] ${action}: ${detail}`);
  }

  private addTargetLog(key: string, action: string, detail: string) {
    const ts = this.targetStates.get(key);
    if (!ts) return;
    const entry = { time: now(), action, detail };
    ts.log.push(entry);
    if (action === "ERROR" || action === "FAIL") {
      notifyTelegram(
        `🚨 <b>Copier ${action}</b>\nSource: <code>${this.sourceLabel()}</code>\nTarget: <code>${ts.account.login}@${ts.account.server}</code>\n${detail}`
      );
    }
    if (ts.log.length > this.maxLog) {
      ts.log = ts.log.slice(-this.maxLog);
    }
  }

  isSource(vpsId: string, server: string, login: string): boolean {
    if (!this.running || !this.config) return false;
    return (
      this.config.sourceVpsId === vpsId &&
      this.config.sourceServer === server &&
      this.config.sourceLogin === login
    );
  }

  isTarget(vpsId: string, server: string, login: string): boolean {
    if (!this.running) return false;
    return this.targetStates.has(`${vpsId}|${server}|${login}`);
  }

  hasAccount(vpsId: string, server: string, login: string): boolean {
    return this.isSource(vpsId, server, login) || this.isTarget(vpsId, server, login);
  }

  getSourceInfo() {
    if (!this.config) return null;
    return { vpsId: this.config.sourceVpsId, server: this.config.sourceServer, login: this.config.sourceLogin };
  }

  async start(config: CopierConfig, restore = false) {
    if (this.running) this.stop();

    this.config = config;
    this.sourcePositions = {};
    this.preExistingTickets = new Set();
    this.targetStates = new Map();
    this.globalLog = [];
    this.running = true;

    const srcLabel = `${config.sourceLogin}@${config.sourceServer}`;
    this.log("START", `Source: ${srcLabel} -> ${config.targets.length} target(s)`);

    for (const t of config.targets) {
      const key = targetKey(t);
      const mode = t.mode ?? "opposite";
      this.targetStates.set(key, {
        account: t,
        mode,
        mirrors: {},
        lastError: null,
        lastSyncedAt: null,
        log: [],
      });
      this.addTargetLog(key, "START", `Target initialized: ${t.login}@${t.server} [${mode}] x${t.volumeMult}`);
    }

    await persistSession(this.id, this.config, true);
    await this.snapshotExisting();

    if (restore) {
      await this.reconstructMirrors();
    }

    this.timer = setInterval(() => {
      if (!this.running || this.polling) return;
      this.polling = true;
      this.poll().finally(() => { this.polling = false; });
    }, 2000);
  }

  /** Count active copied positions across all targets. */
  activeTradeCount(): number {
    let count = 0;
    for (const ts of this.targetStates.values()) {
      for (const m of Object.values(ts.mirrors)) {
        if (m.status === "synced" && m.targetTicket) count++;
      }
    }
    return count;
  }

  /** Close all copied positions on all targets, then stop the session. */
  async stopAndClose(): Promise<{ closed: number; failed: number }> {
    // Stop polling first so no new trades are copied
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    let closed = 0;
    let failed = 0;
    for (const [key, ts] of this.targetStates) {
      const client = await getClient(ts.account.vpsId);
      for (const [ticket, mirror] of Object.entries(ts.mirrors)) {
        if (mirror.status !== "synced" || !mirror.targetTicket) continue;
        try {
          const result = await client.closeTicket(
            ts.account.server, ts.account.login, mirror.targetTicket
          ) as Record<string, string>;
          if (result?.status === "OK") {
            ts.mirrors[ticket] = { status: "closed" };
            closed++;
            this.addTargetLog(key, "CLOSE", `Closed #${mirror.targetTicket} (session stop)`);
          } else {
            failed++;
            this.addTargetLog(key, "ERROR", `Failed to close #${mirror.targetTicket} on stop`);
          }
        } catch (err) {
          failed++;
          this.addTargetLog(key, "ERROR", `Close #${mirror.targetTicket} error: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    this.log("STOP", `Copier stopped: closed ${closed} position(s), ${failed} failed`);
    persistSession(this.id, null, false);
    return { closed, failed };
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log("STOP", "Copier stopped");
    persistSession(this.id, null, false);
  }

  private async snapshotExisting() {
    if (!this.config) return;
    try {
      const client = await getClient(this.config.sourceVpsId);
      const result = await client.getPositions(this.config.sourceServer, this.config.sourceLogin);
      if (result.positions) {
        for (const p of result.positions) {
          const ticket = String(p.pos);
          if (ticket) {
            this.sourcePositions[ticket] = { symbol: p.symbol, type: p.type, volume: String(p.volume) };
            this.preExistingTickets.add(ticket);
          }
        }
      }
      this.log("SNAPSHOT", `Tracking ${Object.keys(this.sourcePositions).length} existing position(s)`);
    } catch (e) {
      this.log("ERROR", `Snapshot failed: ${e}`);
    }
  }

  /**
   * After a restore, scan target accounts for positions with `copy_*` comments
   * and rebuild the mirrors map so closes/partial-closes propagate correctly.
   */
  private async reconstructMirrors() {
    if (!this.config) return;

    for (const [key, ts] of this.targetStates) {
      try {
        const client = await getClient(ts.account.vpsId);
        const result = await client.getPositions(ts.account.server, ts.account.login);
        if (!result.positions) continue;

        for (const p of result.positions) {
          const comment = String(p.comment ?? "");
          if (!comment.startsWith("copy_")) continue;
          const sourceTicket = comment.slice(5); // strip "copy_" prefix
          if (sourceTicket in this.sourcePositions) {
            const targetTicket = parseInt(String(p.pos), 10);
            ts.mirrors[sourceTicket] = {
              status: "synced",
              targetTicket: !isNaN(targetTicket) ? targetTicket : undefined,
            };
          }
        }

        const count = Object.keys(ts.mirrors).length;
        this.addTargetLog(key, "RESTORE", `Reconstructed ${count} mirror(s) from target positions`);
      } catch (e) {
        this.addTargetLog(key, "ERROR", `Mirror reconstruction failed: ${e}`);
      }
    }

    // On restore, pre-existing tickets that have mirrors are NOT pre-existing —
    // they were copied before the restart. Clear them from the pre-existing set
    // so closes propagate correctly.
    for (const ts of this.targetStates.values()) {
      for (const ticket of Object.keys(ts.mirrors)) {
        this.preExistingTickets.delete(ticket);
      }
    }

    this.log("RESTORE", `Mirror state reconstructed for ${this.targetStates.size} target(s)`);
  }

  private async poll() {
    if (!this.config || !this.running) return;

    let current: Record<string, TrackedPosition>;
    try {
      const client = await getClient(this.config.sourceVpsId);
      const result = await client.getPositions(this.config.sourceServer, this.config.sourceLogin);
      current = {};
      if (result.positions) {
        for (const p of result.positions) {
          const ticket = String(p.pos);
          if (ticket) {
            current[ticket] = { symbol: p.symbol, type: p.type, volume: String(p.volume) };
          }
        }
      }
    } catch (e) {
      this.log("ERROR", `Source poll failed: ${e}`);
      return;
    }

    const newTickets: [string, TrackedPosition][] = [];
    for (const [ticket, pos] of Object.entries(current)) {
      if (!(ticket in this.sourcePositions)) newTickets.push([ticket, pos]);
    }

    const closedTickets: [string, TrackedPosition][] = [];
    for (const [ticket, pos] of Object.entries(this.sourcePositions)) {
      if (!(ticket in current)) closedTickets.push([ticket, pos]);
    }

    // Detect partial closes: same ticket, reduced volume
    const partialCloses: [string, number][] = []; // [ticket, volumeReduction]
    for (const [ticket, pos] of Object.entries(current)) {
      const prev = this.sourcePositions[ticket];
      if (prev) {
        const prevVol = parseFloat(prev.volume);
        const curVol = parseFloat(pos.volume);
        if (curVol < prevVol - 0.001) { // tolerance for float comparison
          partialCloses.push([ticket, prevVol - curVol]);
        }
      }
    }

    this.sourcePositions = current;

    for (const [ticket, pos] of newTickets) {
      this.log("NEW", `Source: ${pos.type} ${pos.volume} ${pos.symbol} (#${ticket}) -> ${this.targetStates.size} target(s)`);
      const promises = Array.from(this.targetStates.entries()).map(([key, ts]) => {
        const volume = Math.floor(parseFloat(pos.volume) * ts.account.volumeMult * 100) / 100;
        if (volume < 0.01) {
          this.addTargetLog(key, "SKIP", `Volume too small (${volume}) for ${pos.symbol} #${ticket} — min lot is 0.01`);
          ts.mirrors[ticket] = { status: "synced" }; // mark as handled so close works later
          return Promise.resolve();
        }
        return this.copyToTarget(key, ts, ticket, pos, volume);
      });
      await Promise.allSettled(promises);
    }

    for (const [ticket, pos] of closedTickets) {
      this.log("CLOSED", `Source closed ${pos.type} ${pos.volume} ${pos.symbol} (#${ticket}) -> Closing on ${this.targetStates.size} target(s)`);
      const promises = Array.from(this.targetStates.entries()).map(([key, ts]) =>
        this.closeOnTarget(key, ts, ticket, pos)
      );
      await Promise.allSettled(promises);
    }

    for (const [ticket, reduction] of partialCloses) {
      const pos = current[ticket];
      this.log("PARTIAL", `Source partial close ${reduction.toFixed(2)} of ${pos.symbol} (#${ticket}), remaining ${pos.volume}`);
      const promises = Array.from(this.targetStates.entries()).map(([key, ts]) =>
        this.partialCloseOnTarget(key, ts, ticket, pos, reduction)
      );
      await Promise.allSettled(promises);
    }
  }

  private resolveTradeType(srcType: string, mode: CopyMode): string {
    if (mode === "follow") return srcType;
    return srcType === "BUY" ? "SELL" : "BUY";
  }

  private async copyToTarget(key: string, ts: TargetState, ticket: string, pos: TrackedPosition, volume: number) {
    const tradeType = this.resolveTradeType(pos.type, ts.mode);
    try {
      const client = await getClient(ts.account.vpsId);
      const trade = { symbol: pos.symbol, volume, comment: `copy_${ticket}` };
      const result = tradeType === "BUY"
        ? await client.buy(ts.account.server, ts.account.login, trade)
        : await client.sell(ts.account.server, ts.account.login, trade);

      const r = result as Record<string, string>;
      if (r?.status === "OK") {
        const orderNum = r.order ? parseInt(r.order, 10) : undefined;
        ts.mirrors[ticket] = { status: "synced", targetTicket: orderNum && !isNaN(orderNum) ? orderNum : undefined };
        ts.lastSyncedAt = Date.now();
        ts.lastError = null;
        this.addTargetLog(key, "COPIED", `${tradeType} ${volume} ${pos.symbol} @ ${r.price ?? "?"} — Deal #${r.deal ?? "?"} ticket #${orderNum ?? "?"} [${ts.mode}]`);
      } else {
        const err = r?.message ?? r?.raw ?? JSON.stringify(result);
        ts.mirrors[ticket] = { status: "failed", error: err };
        ts.lastError = err;
        this.addTargetLog(key, "FAIL", `${tradeType} ${volume} ${pos.symbol}: ${err}`);
      }
    } catch (e) {
      const err = String(e);
      ts.mirrors[ticket] = { status: "failed", error: err };
      ts.lastError = err;
      this.addTargetLog(key, "ERROR", `Copy failed: ${err}`);
    }
  }

  private async closeOnTarget(key: string, ts: TargetState, ticket: string, pos: TrackedPosition) {
    const mirror = ts.mirrors[ticket];
    if (!mirror) return;

    try {
      const client = await getClient(ts.account.vpsId);
      const comment = `copy_${ticket}`;

      // If we have the target ticket cached, close by ticket directly
      if (mirror.targetTicket) {
        const result = await client.closeTicket(ts.account.server, ts.account.login, mirror.targetTicket) as Record<string, string>;
        if (result?.status === "OK") {
          ts.mirrors[ticket] = { status: "closed" };
          ts.lastSyncedAt = Date.now();
          this.addTargetLog(key, "CLOSED", `Closed ${pos.symbol} ticket #${mirror.targetTicket}`);
          return;
        }
        // If close-ticket failed (e.g. already closed), fall through to comment search
        this.addTargetLog(key, "WARN", `Close ticket #${mirror.targetTicket} failed, searching by comment`);
      }

      // Fallback: find the copied position by comment and close by ticket
      const positions = await client.getPositions(ts.account.server, ts.account.login);
      const copied = positions.positions?.find(
        (p) => p.comment === comment
      );

      if (!copied) {
        // Position already closed (manually or otherwise) — just mark it
        ts.mirrors[ticket] = { status: "closed" };
        ts.lastSyncedAt = Date.now();
        this.addTargetLog(key, "CLOSED", `${pos.symbol} already closed on target`);
        return;
      }

      const targetTicket = parseInt(String(copied.pos), 10);
      const result = await client.closeTicket(ts.account.server, ts.account.login, targetTicket) as Record<string, string>;
      if (result?.status === "OK") {
        ts.mirrors[ticket] = { status: "closed" };
        ts.lastSyncedAt = Date.now();
        this.addTargetLog(key, "CLOSED", `Closed ${pos.symbol} ticket #${targetTicket}`);
      } else {
        const err = result?.message ?? result?.raw ?? JSON.stringify(result);
        ts.mirrors[ticket] = { status: "close_failed", error: err, targetTicket: !isNaN(targetTicket) ? targetTicket : undefined };
        ts.lastError = err;
        this.addTargetLog(key, "FAIL", `Close ${pos.symbol} ticket #${targetTicket}: ${err}`);
      }
    } catch (e) {
      const err = String(e);
      ts.mirrors[ticket] = { status: "close_failed", error: err };
      ts.lastError = err;
      this.addTargetLog(key, "ERROR", `Close failed: ${err}`);
    }
  }

  private async partialCloseOnTarget(key: string, ts: TargetState, ticket: string, pos: TrackedPosition, sourceReduction: number) {
    const mirror = ts.mirrors[ticket];
    if (!mirror || mirror.status !== "synced") return;

    const closeVolume = Math.floor(sourceReduction * ts.account.volumeMult * 100) / 100;
    if (closeVolume <= 0) return;

    try {
      const client = await getClient(ts.account.vpsId);
      const comment = `copy_${ticket}`;

      // Find the target ticket
      let targetTicket = mirror.targetTicket;
      if (!targetTicket) {
        const positions = await client.getPositions(ts.account.server, ts.account.login);
        const copied = positions.positions?.find((p) => p.comment === comment);
        if (!copied) {
          this.addTargetLog(key, "WARN", `Partial close: copied position not found for ${pos.symbol} (#${ticket})`);
          return;
        }
        targetTicket = parseInt(String(copied.pos), 10);
        mirror.targetTicket = targetTicket;
      }

      const result = await client.closeTicket(ts.account.server, ts.account.login, targetTicket, closeVolume) as Record<string, string>;
      if (result?.status === "OK") {
        ts.lastSyncedAt = Date.now();
        ts.lastError = null;
        this.addTargetLog(key, "PARTIAL", `Partial close ${closeVolume} of ${pos.symbol} ticket #${targetTicket}`);
      } else {
        const err = result?.message ?? result?.raw ?? JSON.stringify(result);
        ts.lastError = err;
        this.addTargetLog(key, "FAIL", `Partial close ${closeVolume} ${pos.symbol} ticket #${targetTicket}: ${err}`);
      }
    } catch (e) {
      const err = String(e);
      ts.lastError = err;
      this.addTargetLog(key, "ERROR", `Partial close failed: ${err}`);
    }
  }

  async addTarget(target: TargetAccount) {
    if (!this.running || !this.config) return { error: "Session not running" };

    const key = targetKey(target);
    if (this.isSource(target.vpsId, target.server, target.login)) {
      return { error: "Cannot copy to the source account" };
    }
    if (this.targetStates.has(key)) {
      return { error: "Account is already a target" };
    }

    const mode = target.mode ?? "opposite";
    const ts: TargetState = {
      account: target, mode, mirrors: {}, lastError: null, lastSyncedAt: null, log: [],
    };
    this.targetStates.set(key, ts);
    this.config.targets.push(target);
    this.addTargetLog(key, "START", `Target added: ${target.login}@${target.server} [${mode}] x${target.volumeMult}`);
    this.log("ADD_TARGET", `Added target: ${target.login}@${target.server} [${mode}] x${target.volumeMult} (now ${this.targetStates.size})`);
    await persistSession(this.id, this.config, true);

    let synced = 0;
    for (const [ticket, pos] of Object.entries(this.sourcePositions)) {
      if (this.preExistingTickets.has(ticket)) continue; // don't copy pre-existing positions
      const volume = Math.floor(parseFloat(pos.volume) * target.volumeMult * 100) / 100;
      if (volume < 0.01) {
        this.addTargetLog(key, "SKIP", `Volume too small (${volume}) for ${pos.symbol} #${ticket}`);
        ts.mirrors[ticket] = { status: "synced" };
        continue;
      }
      await this.copyToTarget(key, ts, ticket, pos, volume);
      synced++;
    }

    return { added: key, syncedExisting: synced };
  }

  removeTarget(key: string, force = false) {
    if (!this.running || !this.config) return { error: "Session not running" };

    const ts = this.targetStates.get(key);
    if (!ts) return { error: "Target not found" };

    // Check for active (synced) mirrors — these are open positions on the target
    if (!force) {
      const activeMirrors = Object.entries(ts.mirrors).filter(
        ([, m]) => m.status === "synced" && m.targetTicket
      );
      if (activeMirrors.length > 0) {
        return {
          error: `Cannot remove — ${activeMirrors.length} active copied trade(s) on ${ts.account.login}@${ts.account.server}. Close them first or use force.`,
          activeCount: activeMirrors.length,
        };
      }
    }

    this.targetStates.delete(key);
    this.config.targets = this.config.targets.filter((t) => targetKey(t) !== key);
    this.log("REMOVE_TARGET", `Removed target: ${ts.account.login}@${ts.account.server} (now ${this.targetStates.size})`);
    persistSession(this.id, this.config, this.targetStates.size > 0);

    if (this.targetStates.size === 0) {
      this.log("STOP", "No targets remaining — session stopped");
      this.stop();
    }

    return { removed: key };
  }

  async retryTarget(tk: string) {
    if (!this.running || !this.config) return { error: "Session not running" };

    const ts = this.targetStates.get(tk);
    if (!ts) return { error: "Target not found" };

    const failedTickets = Object.entries(ts.mirrors)
      .filter(([, m]) => m.status === "failed" || m.status === "close_failed");

    if (failedTickets.length === 0) return { retried: 0 };

    let retried = 0;
    for (const [ticket, mirror] of failedTickets) {
      const pos = this.sourcePositions[ticket];
      if (pos && mirror.status === "failed") {
        const volume = Math.floor(parseFloat(pos.volume) * ts.account.volumeMult * 100) / 100;
        await this.copyToTarget(tk, ts, ticket, pos, volume);
        retried++;
      }
    }

    return { retried };
  }

  getSourcePositionData(): Record<string, TrackedPosition> {
    return { ...this.sourcePositions };
  }

  getMirrors(): Record<string, Record<string, MirrorState>> {
    const result: Record<string, Record<string, MirrorState>> = {};
    for (const [key, ts] of this.targetStates) {
      result[key] = { ...ts.mirrors };
    }
    return result;
  }

  status() {
    const targets = Array.from(this.targetStates.entries()).map(([key, ts]) => {
      const mirrors = Object.values(ts.mirrors);
      const synced = mirrors.filter((m) => m.status === "synced" || m.status === "closed").length;
      const failed = mirrors.filter((m) => m.status === "failed" || m.status === "close_failed").length;
      return {
        key, vpsId: ts.account.vpsId, server: ts.account.server, login: ts.account.login,
        mode: ts.mode, volumeMult: ts.account.volumeMult,
        synced, failed, total: mirrors.length,
        lastError: ts.lastError, lastSyncedAt: ts.lastSyncedAt, log: ts.log.slice(-50),
      };
    });

    const totalSynced = targets.reduce((s, t) => s + t.synced, 0);
    const totalFailed = targets.reduce((s, t) => s + t.failed, 0);
    const totalMirrors = targets.reduce((s, t) => s + t.total, 0);

    return {
      id: this.id,
      running: this.running,
      source: this.config
        ? { vpsId: this.config.sourceVpsId, server: this.config.sourceServer, login: this.config.sourceLogin }
        : null,
      sourcePositions: Object.keys(this.sourcePositions).length,
      targets,
      summary: { synced: totalSynced, failed: totalFailed, total: totalMirrors, targetCount: targets.length },
      log: this.globalLog.slice(-50),
    };
  }
}

// ── Manager: holds multiple copier sessions ──

class CopierManager {
  private sessions: Map<string, CopierSession> = new Map();
  private nextId = 1;

  private genId(): string {
    const id = `session_${this.nextId++}`;
    return id;
  }

  async startSession(config: CopierConfig): Promise<{ sessionId: string }> {
    const id = this.genId();
    const session = new CopierSession(id);
    this.sessions.set(id, session);
    await session.start(config);
    return { sessionId: id };
  }

  stopSession(sessionId: string, closePositions = false) {
    const session = this.sessions.get(sessionId);
    if (!session) return { error: "Session not found" };

    if (closePositions) {
      // Close all copied positions then stop — async but we delete from map immediately
      session.stopAndClose().then(() => {
        // already persisted inside stopAndClose
      });
    } else {
      session.stop();
    }
    this.sessions.delete(sessionId);
    return { stopped: sessionId };
  }

  getSession(sessionId: string): CopierSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Check across ALL sessions
  isActiveTarget(vpsId: string, server: string, login: string): boolean {
    for (const s of this.sessions.values()) {
      if (s.isTarget(vpsId, server, login)) return true;
    }
    return false;
  }

  isActiveSource(vpsId: string, server: string, login: string): boolean {
    for (const s of this.sessions.values()) {
      if (s.isSource(vpsId, server, login)) return true;
    }
    return false;
  }

  isInAnySession(vpsId: string, server: string, login: string): boolean {
    for (const s of this.sessions.values()) {
      if (s.hasAccount(vpsId, server, login)) return true;
    }
    return false;
  }

  getSourceInfo(sessionId: string) {
    return this.sessions.get(sessionId)?.getSourceInfo() ?? null;
  }

  onAccountDeleted(vpsId: string, server: string, login: string) {
    for (const [id, session] of this.sessions) {
      if (session.isSource(vpsId, server, login)) {
        session.stop();
        this.sessions.delete(id);
      } else if (session.isTarget(vpsId, server, login)) {
        session.removeTarget(`${vpsId}|${server}|${login}`);
        if (!session.running) this.sessions.delete(id);
      }
    }
  }

  onVpsDeleted(vpsId: string) {
    for (const [id, session] of this.sessions) {
      const src = session.getSourceInfo();
      if (src && src.vpsId === vpsId) {
        session.stop();
        this.sessions.delete(id);
      } else {
        // remove all targets on this VPS
        const status = session.status();
        for (const t of status.targets) {
          if (t.vpsId === vpsId) {
            session.removeTarget(t.key);
          }
        }
        if (!session.running) this.sessions.delete(id);
      }
    }
  }

  statusAll() {
    return Array.from(this.sessions.values()).map((s) => s.status());
  }

  /** Returns info about sessions that use any account on this VPS */
  getSessionsForVps(vpsId: string): { sessionId: string; role: string; login: string; server: string }[] {
    const results: { sessionId: string; role: string; login: string; server: string }[] = [];
    for (const [id, session] of this.sessions) {
      if (!session.running) continue;
      const src = session.getSourceInfo();
      if (src && src.vpsId === vpsId) {
        results.push({ sessionId: id, role: "source", login: src.login, server: src.server });
      }
      const status = session.status();
      for (const t of status.targets) {
        if (t.vpsId === vpsId) {
          results.push({ sessionId: id, role: "target", login: t.login, server: t.server });
        }
      }
    }
    return results;
  }

  /** Returns info about sessions that use this specific account */
  getSessionsForAccount(vpsId: string, server: string, login: string): { sessionId: string; role: string }[] {
    const results: { sessionId: string; role: string }[] = [];
    for (const [id, session] of this.sessions) {
      if (!session.running) continue;
      if (session.isSource(vpsId, server, login)) {
        results.push({ sessionId: id, role: "source" });
      } else if (session.isTarget(vpsId, server, login)) {
        results.push({ sessionId: id, role: "target" });
      }
    }
    return results;
  }

  async restore(id: string, config: CopierConfig) {
    const session = new CopierSession(id);
    this.sessions.set(id, session);
    // update nextId to avoid collisions
    const num = parseInt(id.replace("session_", ""), 10);
    if (!isNaN(num) && num >= this.nextId) this.nextId = num + 1;
    await session.start(config, true); // restore=true triggers mirror reconstruction
  }
}

const globalForCopier = global as unknown as { copierManager: CopierManager };
export const copierManager = globalForCopier.copierManager || new CopierManager();
globalForCopier.copierManager = copierManager;

// Backwards compat: single-session convenience (used by some routes)
export const copier = {
  isActiveTarget: (v: string, s: string, l: string) => copierManager.isActiveTarget(v, s, l),
  isActiveSource: (v: string, s: string, l: string) => copierManager.isActiveSource(v, s, l),
  getSourceInfo: (sessionId: string) => copierManager.getSourceInfo(sessionId),
  onAccountDeleted: (v: string, s: string, l: string) => copierManager.onAccountDeleted(v, s, l),
  onVpsDeleted: (v: string) => copierManager.onVpsDeleted(v),
  getSessionsForVps: (vpsId: string) => copierManager.getSessionsForVps(vpsId),
  getSessionsForAccount: (v: string, s: string, l: string) => copierManager.getSessionsForAccount(v, s, l),
};

export async function restoreCopierFromDb() {
  try {
    const sessions = await prisma.copierSession.findMany({ where: { running: true } });
    for (const session of sessions) {
      const targets = session.targets as unknown as TargetAccount[];
      if (!targets || targets.length === 0) {
        await prisma.copierSession.delete({ where: { id: session.id } }).catch(() => {});
        continue;
      }
      console.log(`[COPIER] Restoring ${session.id}: ${session.sourceLogin}@${session.sourceServer} -> ${targets.length} target(s)`);
      await copierManager.restore(session.id, {
        sourceVpsId: session.sourceVpsId,
        sourceServer: session.sourceServer,
        sourceLogin: session.sourceLogin,
        targets,
      });
    }
  } catch (e) {
    console.error("[COPIER] Failed to restore sessions:", e);
    notifyTelegram(`🚨 <b>Copier Session Restore Failed</b>\n${e instanceof Error ? e.message : String(e)}`);
  }
}
