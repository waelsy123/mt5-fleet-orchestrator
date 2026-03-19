"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";
import {
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Check,
  AlertTriangle,
  X,
  Plus,
  Eye,
} from "lucide-react";

interface AccountOption {
  vpsId: string;
  vpsName: string;
  login: string;
  server: string;
  balance: number;
}

type CopyMode = "follow" | "opposite";

interface TargetStatus {
  key: string;
  vpsId: string;
  server: string;
  login: string;
  mode: CopyMode;
  volumeMult: number;
  synced: number;
  failed: number;
  total: number;
  lastError: string | null;
  lastSyncedAt: number | null;
  log: { time: string; action: string; detail: string }[];
}

interface SessionStatus {
  id: string;
  running: boolean;
  source: { vpsId: string; server: string; login: string } | null;
  sourcePositions: number;
  targets: TargetStatus[];
  summary: { synced: number; failed: number; total: number; targetCount: number };
  log: { time: string; action: string; detail: string }[];
}

export default function CopierPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch("/api/accounts");
        if (!res.ok) throw new Error("Failed to fetch accounts");
        const json = await res.json();
        setAccounts(
          json.map((a: { vpsId: string; vpsName: string; login: string; server: string; balance: number }) => ({
            vpsId: a.vpsId,
            vpsName: a.vpsName,
            login: a.login,
            server: a.server,
            balance: a.balance ?? 0,
          }))
        );
      } catch {
        toast.error("Failed to load accounts");
      } finally {
        setLoading(false);
      }
    }
    fetchAccounts();
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/copier/status");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  // Poll while any session is running
  const anyRunning = sessions.some((s) => s.running);
  useEffect(() => {
    if (anyRunning) {
      pollRef.current = setInterval(fetchStatus, 2000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [anyRunning, fetchStatus]);

  function accountKey(a: AccountOption) {
    return `${a.vpsId}|${a.server}|${a.login}`;
  }

  function accountLabel(a: AccountOption) {
    const bal = a.balance > 0 ? ` — $${a.balance.toLocaleString()}` : "";
    return `${a.login} @ ${a.server} (${a.vpsName}${bal})`;
  }

  // Accounts already used in any running session
  const usedAccountKeys = new Set<string>();
  for (const s of sessions) {
    if (s.source) usedAccountKeys.add(`${s.source.vpsId}|${s.source.server}|${s.source.login}`);
    for (const t of s.targets) usedAccountKeys.add(t.key);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">Copy Trading</h1>
        <Button
          onClick={() => setShowNewForm(!showNewForm)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Session
        </Button>
      </div>

      {showNewForm && (
        <NewSessionForm
          accounts={accounts}
          usedAccountKeys={usedAccountKeys}
          loading={loading}
          accountKey={accountKey}
          accountLabel={accountLabel}
          onCreated={() => {
            setShowNewForm(false);
            fetchStatus();
          }}
        />
      )}

      {sessions.length === 0 && !showNewForm && (
        <Card className="border-zinc-700 bg-zinc-900">
          <CardContent className="py-8 text-center text-zinc-500">
            No active copier sessions. Click &quot;New Session&quot; to start one.
          </CardContent>
        </Card>
      )}

      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          accounts={accounts}
          usedAccountKeys={usedAccountKeys}
          accountKey={accountKey}
          accountLabel={accountLabel}
          onRefresh={fetchStatus}
        />
      ))}
    </div>
  );
}

// ── New Session Form ──

function NewSessionForm({
  accounts,
  usedAccountKeys,
  loading,
  accountKey,
  accountLabel,
  onCreated,
}: {
  accounts: AccountOption[];
  usedAccountKeys: Set<string>;
  loading: boolean;
  accountKey: (a: AccountOption) => string;
  accountLabel: (a: AccountOption) => string;
  onCreated: () => void;
}) {
  const [sourceAccount, setSourceAccount] = useState("");
  const [selectedTargets, setSelectedTargets] = useState<Map<string, { mode: CopyMode; volumeMult: number | null }>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const availableSources = accounts.filter((a) => !usedAccountKeys.has(accountKey(a)));
  const availableTargets = accounts.filter(
    (a) => accountKey(a) !== sourceAccount && !usedAccountKeys.has(accountKey(a))
  );

  function getSourceBalance(): number {
    const src = accounts.find((a) => accountKey(a) === sourceAccount);
    return src?.balance ?? 0;
  }

  function autoRatio(targetBalance: number): number {
    const srcBal = getSourceBalance();
    if (srcBal <= 0) return 1.0;
    return Math.round((targetBalance / srcBal) * 100) / 100;
  }

  function parseAccountKey(key: string) {
    const [vpsId, server, login] = key.split("|");
    return { vpsId, server, login };
  }

  function toggleTarget(key: string) {
    setSelectedTargets((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        const acct = accounts.find((a) => accountKey(a) === key);
        next.set(key, { mode: "opposite", volumeMult: acct ? autoRatio(acct.balance) : null });
      }
      return next;
    });
  }

  function setTargetMode(key: string, mode: CopyMode) {
    setSelectedTargets((prev) => {
      const next = new Map(prev);
      const existing = next.get(key);
      next.set(key, { mode, volumeMult: existing?.volumeMult ?? null });
      return next;
    });
  }

  function setTargetVolumeMult(key: string, mult: number | null) {
    setSelectedTargets((prev) => {
      const next = new Map(prev);
      const existing = next.get(key);
      next.set(key, { mode: existing?.mode ?? "opposite", volumeMult: mult });
      return next;
    });
  }

  function selectAllTargets() {
    setSelectedTargets(new Map(availableTargets.map((a) => [
      accountKey(a),
      { mode: "opposite" as CopyMode, volumeMult: autoRatio(a.balance) },
    ])));
  }

  // Same-firm warning
  function computeSameFirmWarnings(entries: { server: string; login: string }[]): string[] {
    const serverCounts = new Map<string, string[]>();
    for (const { server, login } of entries) {
      const existing = serverCounts.get(server) ?? [];
      existing.push(login);
      serverCounts.set(server, existing);
    }
    const warnings: string[] = [];
    for (const [server, logins] of serverCounts) {
      if (logins.length > 1) warnings.push(`${server}: ${logins.join(", ")} (${logins.length} accounts)`);
    }
    return warnings;
  }

  const sameFirmWarnings = computeSameFirmWarnings(
    Array.from(selectedTargets.keys()).map(parseAccountKey)
  );

  async function handleStart() {
    if (!sourceAccount || selectedTargets.size === 0) return;

    const source = parseAccountKey(sourceAccount);
    const targets = Array.from(selectedTargets.entries()).map(([key, opts]) => ({
      ...parseAccountKey(key),
      mode: opts.mode,
      ...(opts.volumeMult != null ? { volumeMult: opts.volumeMult } : {}),
    }));

    setSubmitting(true);
    try {
      const res = await fetch("/api/copier/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceVpsId: source.vpsId,
          sourceServer: source.server,
          sourceLogin: source.login,
          targets,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start session");
      }
      toast.success(`Session started: 1 -> ${targets.length} target(s)`);
      onCreated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-zinc-700 bg-zinc-900">
      <CardHeader>
        <CardTitle className="text-zinc-100">New Copier Session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-zinc-500">Loading accounts...</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-zinc-500">No accounts found.</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-zinc-300">Source Account (master)</Label>
              <Select
                value={sourceAccount}
                onValueChange={(v) => {
                  const val = v ?? "";
                  setSourceAccount(val);
                  if (val) {
                    setSelectedTargets((prev) => {
                      const next = new Map(prev);
                      next.delete(val);
                      return next;
                    });
                  }
                }}
              >
                <SelectTrigger className="border-zinc-700 bg-zinc-800 text-zinc-100">
                  <SelectValue placeholder="Select source account" />
                </SelectTrigger>
                <SelectContent className="border-zinc-700 bg-zinc-800">
                  {availableSources.map((a) => (
                    <SelectItem
                      key={`source-${accountKey(a)}`}
                      value={accountKey(a)}
                      className="text-zinc-100 focus:bg-zinc-700 focus:text-zinc-100"
                    >
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sourceAccount && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300">
                      Target Accounts ({selectedTargets.size}/{availableTargets.length})
                    </Label>
                    <div className="flex gap-2">
                      <button onClick={selectAllTargets} className="text-xs text-blue-400 hover:text-blue-300">
                        Select all
                      </button>
                      <span className="text-xs text-zinc-600">|</span>
                      <button onClick={() => setSelectedTargets(new Map())} className="text-xs text-zinc-400 hover:text-zinc-300">
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[240px] overflow-auto rounded border border-zinc-700 bg-zinc-800">
                    {availableTargets.map((a) => {
                      const key = accountKey(a);
                      const checked = selectedTargets.has(key);
                      const opts = selectedTargets.get(key);
                      const mode = opts?.mode ?? "opposite";
                      const mult = opts?.volumeMult;
                      return (
                        <div
                          key={key}
                          className={`flex items-center gap-3 px-3 py-2 hover:bg-zinc-700/50 ${checked ? "bg-zinc-700/30" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTarget(key)}
                            className="accent-emerald-500 cursor-pointer"
                          />
                          <span className="flex-1 text-sm text-zinc-200 cursor-pointer" onClick={() => toggleTarget(key)}>
                            {accountLabel(a)}
                          </span>
                          {checked && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-zinc-500">x</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={mult ?? ""}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  setTargetVolumeMult(key, isNaN(v) ? null : v);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-16 rounded border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 text-right"
                                placeholder="auto"
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTargetMode(key, mode === "follow" ? "opposite" : "follow");
                                }}
                                className={`rounded px-2 py-0.5 text-xs font-medium ${
                                  mode === "follow"
                                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                                    : "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                                }`}
                              >
                                {mode}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {sameFirmWarnings.length > 0 && (
                    <div className="mt-2 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                        <div>
                          <p className="text-xs font-medium text-yellow-400">Multiple accounts from the same firm</p>
                          {sameFirmWarnings.map((w, i) => (
                            <p key={i} className="text-xs text-yellow-300/70">{w}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleStart}
                  disabled={submitting || selectedTargets.size === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {submitting ? "Starting..." : `Start (1 -> ${selectedTargets.size})`}
                </Button>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Session Card ──

function SessionCard({
  session,
  accounts,
  usedAccountKeys,
  accountKey,
  accountLabel,
  onRefresh,
}: {
  session: SessionStatus;
  accounts: AccountOption[];
  usedAccountKeys: Set<string>;
  accountKey: (a: AccountOption) => string;
  accountLabel: (a: AccountOption) => string;
  onRefresh: () => void;
}) {
  const [expandedTarget, setExpandedTarget] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [addingTarget, setAddingTarget] = useState(false);
  const [removingTarget, setRemovingTarget] = useState<string | null>(null);
  const [addTargetMode, setAddTargetMode] = useState<CopyMode>("opposite");

  const sourceLabel = session.source
    ? `${session.source.login}@${session.source.server}`
    : "Unknown";

  const sourceKey = session.source
    ? `${session.source.vpsId}|${session.source.server}|${session.source.login}`
    : "";

  const sessionTargetKeys = new Set(session.targets.map((t) => t.key));
  const addableAccounts = accounts.filter(
    (a) => accountKey(a) !== sourceKey && !usedAccountKeys.has(accountKey(a)) && !sessionTargetKeys.has(accountKey(a))
  );

  async function handleStop(force = false) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/copier/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.activeCount) {
          const confirmed = window.confirm(
            `${data.activeCount} active copied trade(s) on target accounts.\n\nClose all copied positions and stop the session?`
          );
          if (confirmed) {
            await handleStop(true);
            return;
          }
        } else {
          throw new Error(data.error || "Failed to stop session");
        }
        return;
      }
      toast.success(data.message || "Session stopped");
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to stop");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry(targetKey: string) {
    setRetrying(targetKey);
    try {
      const res = await fetch("/api/copier/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, targetKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Retry failed");
      }
      const data = await res.json();
      toast.success(`Retried ${data.retried} failed trade(s)`);
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  }

  async function handleAddTarget(key: string, mode: CopyMode) {
    const [vpsId, server, login] = key.split("|");
    setAddingTarget(true);
    try {
      const res = await fetch("/api/copier/add-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, vpsId, server, login, mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add target");
      }
      const data = await res.json();
      toast.success(`Target added — synced ${data.syncedExisting} existing position(s)`);
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add target");
    } finally {
      setAddingTarget(false);
    }
  }

  async function handleRemoveTarget(targetKey: string, force = false) {
    setRemovingTarget(targetKey);
    try {
      const res = await fetch("/api/copier/remove-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, targetKey, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.activeCount) {
          const confirmed = window.confirm(
            `${data.error}\n\nRemove anyway? The copied positions will NOT be closed automatically.`
          );
          if (confirmed) {
            await handleRemoveTarget(targetKey, true);
            return;
          }
        } else {
          throw new Error(data.error || "Failed to remove target");
        }
        return;
      }
      toast.success("Target removed");
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to remove target");
    } finally {
      setRemovingTarget(null);
    }
  }

  function logColor(action: string) {
    switch (action) {
      case "START": return "text-blue-400";
      case "NEW": case "CLOSED": return "text-yellow-400";
      case "COPIED": case "CLOSED_TARGET": return "text-emerald-400";
      case "FAIL": case "ERROR": return "text-red-400";
      case "ADD_TARGET": return "text-blue-400";
      case "REMOVE_TARGET": return "text-orange-400";
      case "SNAPSHOT": case "STOP": return "text-zinc-500";
      default: return "text-green-400";
    }
  }

  function targetStatusIcon(t: TargetStatus) {
    if (t.total === 0) return <span className="text-zinc-500">--</span>;
    if (t.failed > 0) return <AlertTriangle className="inline h-4 w-4 text-yellow-400" />;
    return <Check className="inline h-4 w-4 text-emerald-400" />;
  }

  function targetStatusBadge(t: TargetStatus) {
    if (t.total === 0)
      return <Badge className="bg-zinc-700/50 text-zinc-400 border-zinc-600 text-xs">idle</Badge>;
    if (t.failed > 0)
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">{t.synced}/{t.total}</Badge>;
    return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">{t.synced}/{t.total}</Badge>;
  }

  function timeSince(ts: number | null) {
    if (!ts) return "--";
    const sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}s ago`;
    return `${Math.round(sec / 60)}m ago`;
  }

  function findAccountByKey(key: string) {
    return accounts.find((a) => accountKey(a) === key);
  }

  // Same-firm warnings
  const runningSameFirmWarnings = (() => {
    const serverCounts = new Map<string, string[]>();
    for (const t of session.targets) {
      const existing = serverCounts.get(t.server) ?? [];
      existing.push(t.login);
      serverCounts.set(t.server, existing);
    }
    const warnings: string[] = [];
    for (const [server, logins] of serverCounts) {
      if (logins.length > 1) warnings.push(`${server}: ${logins.join(", ")} (${logins.length} accounts)`);
    }
    return warnings;
  })();

  return (
    <Card className="border-zinc-700 bg-zinc-900">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-zinc-100 text-base font-mono">{sourceLabel}</CardTitle>
            <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">
              {session.running ? "Running" : "Stopped"}
            </Badge>
            <span className="text-xs text-zinc-500">{session.id}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span>Positions: <span className="text-zinc-200">{session.sourcePositions}</span></span>
            <span>{session.summary.targetCount} target(s)</span>
            {session.running && (
              <>
                <Link
                  href={`/copier/trades?sessionId=${encodeURIComponent(session.id)}`}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                >
                  <Eye className="h-3 w-3" />
                  Trades
                </Link>
                <Button
                  size="sm"
                  onClick={() => handleStop()}
                  disabled={submitting}
                  variant="ghost"
                  className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                >
                  <Square className="mr-1 h-3 w-3" />
                  Stop
                </Button>
              </>
            )}
          </div>
        </div>
        {runningSameFirmWarnings.length > 0 && (
          <div className="mt-2 flex items-start gap-2 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
            <div>
              <p className="text-xs font-medium text-yellow-400">Same firm</p>
              {runningSameFirmWarnings.map((w, i) => (
                <p key={i} className="text-xs text-yellow-300/70">{w}</p>
              ))}
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {/* Summary */}
        {session.summary.total > 0 && (
          <div className="border-b border-zinc-700 px-4 py-2">
            {session.summary.failed > 0 ? (
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                {session.summary.synced}/{session.summary.total} synced ({session.summary.failed} failed)
              </Badge>
            ) : (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                {session.summary.synced}/{session.summary.total} synced
              </Badge>
            )}
          </div>
        )}

        {/* Target table */}
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-left text-zinc-400">
                <th className="px-4 py-2 font-medium"></th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Ratio</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Synced</th>
                <th className="px-4 py-2 font-medium">Last Sync</th>
                <th className="px-4 py-2 font-medium">Last Error</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {session.targets.map((t) => {
                const acct = findAccountByKey(t.key);
                const vpsName = acct?.vpsName ?? "";
                const isExpanded = expandedTarget === t.key;
                return (
                  <TargetRow
                    key={t.key}
                    t={t}
                    vpsName={vpsName}
                    isExpanded={isExpanded}
                    isRunning={session.running}
                    retrying={retrying}
                    removingTarget={removingTarget}
                    onToggleExpand={() => setExpandedTarget(isExpanded ? null : t.key)}
                    onRetry={handleRetry}
                    onRemove={handleRemoveTarget}
                    logColor={logColor}
                    targetStatusIcon={targetStatusIcon}
                    targetStatusBadge={targetStatusBadge}
                    timeSince={timeSince}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add target */}
        {session.running && addableAccounts.length > 0 && (
          <div className="border-t border-zinc-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <Select
                onValueChange={(v) => {
                  if (typeof v === "string" && v) handleAddTarget(v, addTargetMode);
                }}
                disabled={addingTarget}
              >
                <SelectTrigger className="h-8 w-[320px] border-zinc-700 bg-zinc-800 text-zinc-100 text-xs">
                  <SelectValue placeholder={addingTarget ? "Adding..." : "Add target account..."} />
                </SelectTrigger>
                <SelectContent className="border-zinc-700 bg-zinc-800">
                  {addableAccounts.map((a) => (
                    <SelectItem
                      key={accountKey(a)}
                      value={accountKey(a)}
                      className="text-zinc-100 text-xs focus:bg-zinc-700 focus:text-zinc-100"
                    >
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={() => setAddTargetMode(addTargetMode === "follow" ? "opposite" : "follow")}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  addTargetMode === "follow"
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                }`}
              >
                {addTargetMode}
              </button>
            </div>
          </div>
        )}

        {/* Activity log (collapsed by default) */}
        <SessionLog log={session.log} logColor={logColor} />
      </CardContent>
    </Card>
  );
}

// ── Target Row ──

function TargetRow({
  t,
  vpsName,
  isExpanded,
  isRunning,
  retrying,
  removingTarget,
  onToggleExpand,
  onRetry,
  onRemove,
  logColor,
  targetStatusIcon,
  targetStatusBadge,
  timeSince,
}: {
  t: TargetStatus;
  vpsName: string;
  isExpanded: boolean;
  isRunning: boolean;
  retrying: string | null;
  removingTarget: string | null;
  onToggleExpand: () => void;
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
  logColor: (action: string) => string;
  targetStatusIcon: (t: TargetStatus) => React.ReactNode;
  targetStatusBadge: (t: TargetStatus) => React.ReactNode;
  timeSince: (ts: number | null) => string;
}) {
  return (
    <>
      <tr
        className="border-b border-zinc-800 hover:bg-zinc-800/50 cursor-pointer"
        onClick={onToggleExpand}
      >
        <td className="px-4 py-2 text-zinc-500">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="px-4 py-2">
          <span className="font-mono text-zinc-200">{t.login}@{t.server}</span>
          {vpsName && <span className="ml-2 text-xs text-zinc-500">({vpsName})</span>}
          <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            t.mode === "follow"
              ? "bg-blue-500/20 text-blue-400"
              : "bg-orange-500/20 text-orange-400"
          }`}>
            {t.mode}
          </span>
        </td>
        <td className="px-4 py-2 font-mono text-xs text-zinc-300">x{t.volumeMult}</td>
        <td className="px-4 py-2">{targetStatusIcon(t)}</td>
        <td className="px-4 py-2">{targetStatusBadge(t)}</td>
        <td className="px-4 py-2 text-zinc-400">{timeSince(t.lastSyncedAt)}</td>
        <td className="max-w-[200px] truncate px-4 py-2 text-xs text-red-400">{t.lastError ?? ""}</td>
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            {t.failed > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
                disabled={retrying === t.key}
                onClick={(e) => { e.stopPropagation(); onRetry(t.key); }}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                {retrying === t.key ? "..." : "Retry"}
              </Button>
            )}
            {isRunning && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                disabled={removingTarget === t.key}
                onClick={(e) => { e.stopPropagation(); onRemove(t.key); }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={8} className="bg-black/50 px-4 py-2">
            <div className="max-h-[200px] overflow-auto rounded bg-black p-3 font-mono text-xs">
              {t.log.length > 0 ? (
                t.log.map((entry, i) => (
                  <div key={i} className="whitespace-pre-wrap">
                    <span className="text-zinc-600">{entry.time}</span>{" "}
                    <span className={logColor(entry.action)}>[{entry.action}]</span>{" "}
                    <span className="text-zinc-300">{entry.detail}</span>
                  </div>
                ))
              ) : (
                <span className="text-zinc-600">No activity yet.</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Session Activity Log ──

function SessionLog({
  log,
  logColor,
}: {
  log: { time: string; action: string; detail: string }[];
  logColor: (action: string) => string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-zinc-700">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800/50"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Activity Log ({log.length})
      </button>
      {open && (
        <div className="max-h-[200px] overflow-auto bg-black p-4 font-mono text-xs">
          {log.length > 0 ? (
            log.map((entry, i) => (
              <div key={i} className="whitespace-pre-wrap">
                <span className="text-zinc-600">{entry.time}</span>{" "}
                <span className={logColor(entry.action)}>[{entry.action}]</span>{" "}
                <span className="text-zinc-300">{entry.detail}</span>
              </div>
            ))
          ) : (
            <p className="text-zinc-600">No log entries yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
