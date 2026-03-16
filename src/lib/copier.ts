import { VpsClient } from "./vps-client";
import { prisma } from "./prisma";

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
}

export interface TargetAccount {
  vpsId: string;
  server: string;
  login: string;
}

interface TargetState {
  account: TargetAccount;
  // source ticket -> mirror state
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
  volumeMult: number;
}

function targetKey(t: TargetAccount) {
  return `${t.vpsId}|${t.server}|${t.login}`;
}

function now() {
  return new Date().toTimeString().slice(0, 8);
}

class OppositeCopier {
  running = false;
  config: CopierConfig | null = null;
  private sourcePositions: Record<string, TrackedPosition> = {};
  private targetStates: Map<string, TargetState> = new Map();
  private globalLog: LogEntry[] = [];
  private maxLog = 200;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  // Cache VpsClient per vpsId to avoid repeated DB lookups every 2s
  private clientCache: Map<string, VpsClient> = new Map();

  private addGlobalLog(action: string, detail: string) {
    const entry = { time: now(), action, detail };
    this.globalLog.push(entry);
    if (this.globalLog.length > this.maxLog) {
      this.globalLog = this.globalLog.slice(-this.maxLog);
    }
    console.log(`[COPIER] ${action}: ${detail}`);
  }

  private addTargetLog(key: string, action: string, detail: string) {
    const ts = this.targetStates.get(key);
    if (!ts) return;
    const entry = { time: now(), action, detail };
    ts.log.push(entry);
    if (ts.log.length > this.maxLog) {
      ts.log = ts.log.slice(-this.maxLog);
    }
  }

  private async getClient(vpsId: string): Promise<VpsClient> {
    const cached = this.clientCache.get(vpsId);
    if (cached) return cached;
    const vps = await prisma.vps.findUniqueOrThrow({ where: { id: vpsId } });
    const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });
    this.clientCache.set(vpsId, client);
    return client;
  }

  async start(config: CopierConfig) {
    if (this.running) {
      this.stop();
    }

    this.config = config;
    this.sourcePositions = {};
    this.targetStates = new Map();
    this.globalLog = [];
    this.clientCache = new Map();
    this.running = true;

    const srcLabel = `${config.sourceLogin}@${config.sourceServer}`;
    this.addGlobalLog("START", `Source: ${srcLabel} -> ${config.targets.length} target(s) (x${config.volumeMult}, opposite)`);

    for (const t of config.targets) {
      const key = targetKey(t);
      this.targetStates.set(key, {
        account: t,
        mirrors: {},
        lastError: null,
        lastSyncedAt: null,
        log: [],
      });
      this.addTargetLog(key, "START", `Target initialized: ${t.login}@${t.server}`);
    }

    await this.snapshotExisting();

    this.timer = setInterval(() => {
      if (!this.running || this.polling) return;
      this.polling = true;
      this.poll().finally(() => {
        this.polling = false;
      });
    }, 2000);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clientCache = new Map();
    this.addGlobalLog("STOP", "Copier stopped");
  }

  private async snapshotExisting() {
    if (!this.config) return;
    try {
      const client = await this.getClient(this.config.sourceVpsId);
      const result = await client.getPositions(this.config.sourceServer, this.config.sourceLogin);
      if (result.positions) {
        for (const p of result.positions) {
          const ticket = String(p.pos);
          if (ticket) {
            this.sourcePositions[ticket] = {
              symbol: p.symbol,
              type: p.type,
              volume: String(p.volume),
            };
          }
        }
      }
      const count = Object.keys(this.sourcePositions).length;
      this.addGlobalLog("SNAPSHOT", `Tracking ${count} existing position(s) — will not copy pre-existing`);
    } catch (e) {
      this.addGlobalLog("ERROR", `Snapshot failed: ${e}`);
    }
  }

  private async poll() {
    if (!this.config || !this.running) return;

    let current: Record<string, TrackedPosition>;
    try {
      const client = await this.getClient(this.config.sourceVpsId);
      const result = await client.getPositions(this.config.sourceServer, this.config.sourceLogin);
      current = {};
      if (result.positions) {
        for (const p of result.positions) {
          const ticket = String(p.pos);
          if (ticket) {
            current[ticket] = {
              symbol: p.symbol,
              type: p.type,
              volume: String(p.volume),
            };
          }
        }
      }
    } catch (e) {
      this.addGlobalLog("ERROR", `Source poll failed: ${e}`);
      return;
    }

    // Detect new positions
    const newTickets: [string, TrackedPosition][] = [];
    for (const [ticket, pos] of Object.entries(current)) {
      if (!(ticket in this.sourcePositions)) {
        newTickets.push([ticket, pos]);
      }
    }

    // Detect closed positions
    const closedTickets: [string, TrackedPosition][] = [];
    for (const [ticket, pos] of Object.entries(this.sourcePositions)) {
      if (!(ticket in current)) {
        closedTickets.push([ticket, pos]);
      }
    }

    this.sourcePositions = current;

    // Fan out new positions to all targets in parallel
    for (const [ticket, pos] of newTickets) {
      const oppType = pos.type === "BUY" ? "SELL" : "BUY";
      const volume = Math.round(parseFloat(pos.volume) * this.config.volumeMult * 100) / 100;
      this.addGlobalLog("NEW", `Source: ${pos.type} ${pos.volume} ${pos.symbol} (#${ticket}) -> ${oppType} ${volume} to ${this.targetStates.size} target(s)`);

      const promises = Array.from(this.targetStates.entries()).map(([key, ts]) =>
        this.copyToTarget(key, ts, ticket, pos, oppType, volume)
      );
      await Promise.allSettled(promises);
    }

    // Fan out closed positions to all targets in parallel
    for (const [ticket, pos] of closedTickets) {
      this.addGlobalLog("CLOSED", `Source closed ${pos.type} ${pos.volume} ${pos.symbol} (#${ticket}) -> Closing on ${this.targetStates.size} target(s)`);

      const promises = Array.from(this.targetStates.entries()).map(([key, ts]) =>
        this.closeOnTarget(key, ts, ticket, pos)
      );
      await Promise.allSettled(promises);
    }
  }

  private async copyToTarget(
    key: string,
    ts: TargetState,
    ticket: string,
    pos: TrackedPosition,
    oppType: string,
    volume: number
  ) {
    try {
      const client = await this.getClient(ts.account.vpsId);
      const trade = { symbol: pos.symbol, volume, comment: `copy_${ticket}` };
      const result = oppType === "BUY"
        ? await client.buy(ts.account.server, ts.account.login, trade)
        : await client.sell(ts.account.server, ts.account.login, trade);

      const r = result as Record<string, string>;
      if (r?.status === "OK") {
        ts.mirrors[ticket] = { status: "synced" };
        ts.lastSyncedAt = Date.now();
        ts.lastError = null;
        this.addTargetLog(key, "COPIED", `${oppType} ${volume} ${pos.symbol} @ ${r.price ?? "?"} — Deal #${r.deal ?? "?"}`);
      } else {
        const err = r?.message ?? r?.raw ?? JSON.stringify(result);
        ts.mirrors[ticket] = { status: "failed", error: err };
        ts.lastError = err;
        this.addTargetLog(key, "FAIL", `${oppType} ${volume} ${pos.symbol}: ${err}`);
      }
    } catch (e) {
      const err = String(e);
      ts.mirrors[ticket] = { status: "failed", error: err };
      ts.lastError = err;
      this.addTargetLog(key, "ERROR", `Copy failed: ${err}`);
    }
  }

  private async closeOnTarget(
    key: string,
    ts: TargetState,
    ticket: string,
    pos: TrackedPosition
  ) {
    if (!ts.mirrors[ticket]) return; // was never copied to this target

    try {
      const client = await this.getClient(ts.account.vpsId);
      const result = await client.close(ts.account.server, ts.account.login, pos.symbol) as Record<string, string>;

      if (result?.status === "OK") {
        ts.mirrors[ticket] = { status: "closed" };
        ts.lastSyncedAt = Date.now();
        this.addTargetLog(key, "CLOSED", `Closed ${pos.symbol} — ${result.closed ?? "?"} position(s)`);
      } else {
        const err = result?.message ?? result?.raw ?? JSON.stringify(result);
        ts.mirrors[ticket] = { status: "close_failed", error: err };
        ts.lastError = err;
        this.addTargetLog(key, "FAIL", `Close ${pos.symbol}: ${err}`);
      }
    } catch (e) {
      const err = String(e);
      ts.mirrors[ticket] = { status: "close_failed", error: err };
      ts.lastError = err;
      this.addTargetLog(key, "ERROR", `Close failed: ${err}`);
    }
  }

  async addTarget(target: TargetAccount) {
    if (!this.running || !this.config) return { error: "Copier not running" };

    const key = targetKey(target);

    // Don't allow adding the source as a target
    if (
      target.vpsId === this.config.sourceVpsId &&
      target.server === this.config.sourceServer &&
      target.login === this.config.sourceLogin
    ) {
      return { error: "Cannot copy to the source account" };
    }

    // Already a target
    if (this.targetStates.has(key)) {
      return { error: "Account is already a target" };
    }

    const ts: TargetState = {
      account: target,
      mirrors: {},
      lastError: null,
      lastSyncedAt: null,
      log: [],
    };
    this.targetStates.set(key, ts);
    this.config.targets.push(target);
    this.addTargetLog(key, "START", `Target added while running: ${target.login}@${target.server}`);
    this.addGlobalLog("ADD_TARGET", `Added target: ${target.login}@${target.server} (now ${this.targetStates.size} target(s))`);

    // Sync: copy all current source positions to the new target
    for (const [ticket, pos] of Object.entries(this.sourcePositions)) {
      const oppType = pos.type === "BUY" ? "SELL" : "BUY";
      const volume = Math.round(parseFloat(pos.volume) * this.config.volumeMult * 100) / 100;
      await this.copyToTarget(key, ts, ticket, pos, oppType, volume);
    }

    return { added: key, syncedExisting: Object.keys(this.sourcePositions).length };
  }

  removeTarget(key: string) {
    if (!this.running || !this.config) return { error: "Copier not running" };

    const ts = this.targetStates.get(key);
    if (!ts) return { error: "Target not found" };

    this.targetStates.delete(key);
    this.config.targets = this.config.targets.filter((t) => targetKey(t) !== key);
    this.clientCache.delete(ts.account.vpsId);
    this.addGlobalLog("REMOVE_TARGET", `Removed target: ${ts.account.login}@${ts.account.server} (now ${this.targetStates.size} target(s))`);

    // If no targets left, stop the copier
    if (this.targetStates.size === 0) {
      this.addGlobalLog("STOP", "No targets remaining — copier stopped");
      this.stop();
    }

    return { removed: key };
  }

  // Called when an account is deleted — remove from copier if it's a target, stop if it's the source
  onAccountDeleted(vpsId: string, server: string, login: string) {
    if (!this.running || !this.config) return;

    // If source is deleted, stop everything
    if (
      this.config.sourceVpsId === vpsId &&
      this.config.sourceServer === server &&
      this.config.sourceLogin === login
    ) {
      this.addGlobalLog("STOP", `Source account ${login}@${server} was deleted — copier stopped`);
      this.stop();
      return;
    }

    // If it's a target, remove it
    const key = `${vpsId}|${server}|${login}`;
    if (this.targetStates.has(key)) {
      this.removeTarget(key);
    }
  }

  // Called when a VPS is deleted — remove all its targets, stop if source VPS
  onVpsDeleted(vpsId: string) {
    if (!this.running || !this.config) return;

    if (this.config.sourceVpsId === vpsId) {
      this.addGlobalLog("STOP", `Source VPS was deleted — copier stopped`);
      this.stop();
      return;
    }

    // Remove all targets on this VPS
    const toRemove = Array.from(this.targetStates.entries())
      .filter(([, ts]) => ts.account.vpsId === vpsId)
      .map(([key]) => key);

    for (const key of toRemove) {
      this.removeTarget(key);
    }
  }

  async retryTarget(targetKey: string) {
    if (!this.running || !this.config) return { error: "Copier not running" };

    const ts = this.targetStates.get(targetKey);
    if (!ts) return { error: "Target not found" };

    const failedTickets = Object.entries(ts.mirrors)
      .filter(([, m]) => m.status === "failed" || m.status === "close_failed");

    if (failedTickets.length === 0) return { retried: 0 };

    let retried = 0;
    for (const [ticket, mirror] of failedTickets) {
      const pos = this.sourcePositions[ticket];
      if (pos && mirror.status === "failed") {
        // Position still open on source — retry copy
        const oppType = pos.type === "BUY" ? "SELL" : "BUY";
        const volume = Math.round(parseFloat(pos.volume) * this.config.volumeMult * 100) / 100;
        await this.copyToTarget(targetKey, ts, ticket, pos, oppType, volume);
        retried++;
      } else if (!pos && mirror.status === "close_failed") {
        // Position closed on source — retry close (we don't have pos anymore, but we have symbol from mirror)
        // Can't retry close without symbol — skip
      }
    }

    return { retried };
  }

  status() {
    const targets = Array.from(this.targetStates.entries()).map(([key, ts]) => {
      const mirrors = Object.values(ts.mirrors);
      const synced = mirrors.filter((m) => m.status === "synced" || m.status === "closed").length;
      const failed = mirrors.filter((m) => m.status === "failed" || m.status === "close_failed").length;
      const total = mirrors.length;

      return {
        key,
        vpsId: ts.account.vpsId,
        server: ts.account.server,
        login: ts.account.login,
        synced,
        failed,
        total,
        lastError: ts.lastError,
        lastSyncedAt: ts.lastSyncedAt,
        log: ts.log.slice(-50),
      };
    });

    const totalSynced = targets.reduce((s, t) => s + t.synced, 0);
    const totalFailed = targets.reduce((s, t) => s + t.failed, 0);
    const totalMirrors = targets.reduce((s, t) => s + t.total, 0);

    return {
      running: this.running,
      source: this.config
        ? { vpsId: this.config.sourceVpsId, server: this.config.sourceServer, login: this.config.sourceLogin }
        : null,
      volumeMult: this.config?.volumeMult ?? 1.0,
      sourcePositions: Object.keys(this.sourcePositions).length,
      targets,
      summary: { synced: totalSynced, failed: totalFailed, total: totalMirrors, targetCount: targets.length },
      log: this.globalLog.slice(-50),
    };
  }
}

export const copier = new OppositeCopier();
