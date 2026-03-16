"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Check,
  AlertTriangle,
  X,
} from "lucide-react";

interface AccountOption {
  vpsId: string;
  vpsName: string;
  login: string;
  server: string;
}

type CopyMode = "follow" | "opposite";

interface TargetStatus {
  key: string;
  vpsId: string;
  server: string;
  login: string;
  mode: CopyMode;
  synced: number;
  failed: number;
  total: number;
  lastError: string | null;
  lastSyncedAt: number | null;
  log: { time: string; action: string; detail: string }[];
}

interface CopierStatus {
  running: boolean;
  source: { vpsId: string; server: string; login: string } | null;
  volumeMult: number;
  sourcePositions: number;
  targets: TargetStatus[];
  summary: { synced: number; failed: number; total: number; targetCount: number };
  log: { time: string; action: string; detail: string }[];
}

export default function CopierPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [sourceAccount, setSourceAccount] = useState("");
  const [selectedTargets, setSelectedTargets] = useState<Map<string, CopyMode>>(new Map());
  const [addTargetMode, setAddTargetMode] = useState<CopyMode>("opposite");
  const [multiplier, setMultiplier] = useState("1.0");
  const [status, setStatus] = useState<CopierStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [expandedTarget, setExpandedTarget] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [addingTarget, setAddingTarget] = useState(false);
  const [removingTarget, setRemovingTarget] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch("/api/accounts");
        if (!res.ok) throw new Error("Failed to fetch accounts");
        const json = await res.json();
        setAccounts(
          json.map((a: { vpsId: string; vpsName: string; login: string; server: string }) => ({
            vpsId: a.vpsId,
            vpsName: a.vpsName,
            login: a.login,
            server: a.server,
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
        setStatus(await res.json());
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (status?.running) {
      pollRef.current = setInterval(fetchStatus, 2000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status?.running, fetchStatus]);

  function accountKey(a: AccountOption) {
    return `${a.vpsId}|${a.server}|${a.login}`;
  }

  function accountLabel(a: AccountOption) {
    return `${a.login} @ ${a.server} (${a.vpsName})`;
  }

  function parseAccountKey(key: string) {
    const [vpsId, server, login] = key.split("|");
    return { vpsId, server, login };
  }

  const availableTargets = accounts.filter((a) => accountKey(a) !== sourceAccount);

  function toggleTarget(key: string) {
    setSelectedTargets((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, "opposite");
      return next;
    });
  }

  function setTargetMode(key: string, mode: CopyMode) {
    setSelectedTargets((prev) => {
      const next = new Map(prev);
      next.set(key, mode);
      return next;
    });
  }

  function selectAllTargets() {
    setSelectedTargets(new Map(availableTargets.map((a) => [accountKey(a), "opposite" as CopyMode])));
  }

  function deselectAllTargets() {
    setSelectedTargets(new Map());
  }

  function findAccountByKey(key: string): AccountOption | undefined {
    return accounts.find((a) => accountKey(a) === key);
  }

  async function handleStart() {
    if (!sourceAccount) {
      toast.error("Please select a source account");
      return;
    }
    if (selectedTargets.size === 0) {
      toast.error("Please select at least one target account");
      return;
    }

    const source = parseAccountKey(sourceAccount);
    const targets = Array.from(selectedTargets.entries()).map(([key, mode]) => ({
      ...parseAccountKey(key),
      mode,
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
          volumeMult: parseFloat(multiplier),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start copier");
      }
      toast.success(`Copy trading started: 1 -> ${targets.length} target(s)`);
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to start copier");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/copier/stop", { method: "POST" });
      if (!res.ok) throw new Error("Failed to stop copier");
      toast.success("Copy trading stopped");
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to stop copier");
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
        body: JSON.stringify({ targetKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Retry failed");
      }
      const data = await res.json();
      toast.success(`Retried ${data.retried} failed trade(s)`);
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  }

  async function handleAddTarget(key: string, mode: CopyMode = "opposite") {
    const { vpsId, server, login } = parseAccountKey(key);
    setAddingTarget(true);
    try {
      const res = await fetch("/api/copier/add-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vpsId, server, login, mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add target");
      }
      const data = await res.json();
      toast.success(`Target added — synced ${data.syncedExisting} existing position(s)`);
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add target");
    } finally {
      setAddingTarget(false);
    }
  }

  async function handleRemoveTarget(targetKey: string) {
    setRemovingTarget(targetKey);
    try {
      const res = await fetch("/api/copier/remove-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove target");
      }
      toast.success("Target removed");
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to remove target");
    } finally {
      setRemovingTarget(null);
    }
  }

  // Accounts not currently in the copier's target list (for the "add target" dropdown)
  const activeTargetKeys = new Set(status?.targets.map((t) => t.key) ?? []);
  const sourceKey = status?.source
    ? `${status.source.vpsId}|${status.source.server}|${status.source.login}`
    : sourceAccount;
  const addableAccounts = accounts.filter(
    (a) => accountKey(a) !== sourceKey && !activeTargetKeys.has(accountKey(a))
  );

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
    if (t.failed > 0)
      return <AlertTriangle className="inline h-4 w-4 text-yellow-400" />;
    return <Check className="inline h-4 w-4 text-emerald-400" />;
  }

  function targetStatusBadge(t: TargetStatus) {
    if (t.total === 0)
      return <Badge className="bg-zinc-700/50 text-zinc-400 border-zinc-600 text-xs">idle</Badge>;
    if (t.failed > 0)
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
          {t.synced}/{t.total}
        </Badge>
      );
    return (
      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
        {t.synced}/{t.total}
      </Badge>
    );
  }

  function timeSince(ts: number | null) {
    if (!ts) return "--";
    const sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 60) return `${sec}s ago`;
    return `${Math.round(sec / 60)}m ago`;
  }

  const isRunning = status?.running === true;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Copy Trading</h1>

      {/* Configuration */}
      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-zinc-100">Configuration</CardTitle>
            {isRunning && (
              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">
                Running
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-zinc-500">Loading accounts...</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No accounts found. Add accounts to your VPS instances first.
            </p>
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
                  disabled={isRunning}
                >
                  <SelectTrigger className="border-zinc-700 bg-zinc-800 text-zinc-100">
                    <SelectValue placeholder="Select source account" />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-800">
                    {accounts.map((a) => (
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
                      {!isRunning && (
                        <div className="flex gap-2">
                          <button
                            onClick={selectAllTargets}
                            className="text-xs text-blue-400 hover:text-blue-300"
                          >
                            Select all
                          </button>
                          <span className="text-xs text-zinc-600">|</span>
                          <button
                            onClick={deselectAllTargets}
                            className="text-xs text-zinc-400 hover:text-zinc-300"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="max-h-[240px] overflow-auto rounded border border-zinc-700 bg-zinc-800">
                      {availableTargets.map((a) => {
                        const key = accountKey(a);
                        const checked = selectedTargets.has(key);
                        const mode = selectedTargets.get(key) ?? "opposite";
                        return (
                          <div
                            key={key}
                            className={`flex items-center gap-3 px-3 py-2 hover:bg-zinc-700/50 ${
                              checked ? "bg-zinc-700/30" : ""
                            } ${isRunning ? "pointer-events-none opacity-60" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTarget(key)}
                              disabled={isRunning}
                              className="accent-emerald-500 cursor-pointer"
                            />
                            <span className="flex-1 text-sm text-zinc-200 cursor-pointer" onClick={() => toggleTarget(key)}>
                              {accountLabel(a)}
                            </span>
                            {checked && (
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
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-zinc-300">Volume Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={multiplier}
                      onChange={(e) => setMultiplier(e.target.value)}
                      className="border-zinc-700 bg-zinc-800 text-zinc-100"
                      disabled={isRunning}
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      onClick={handleStart}
                      disabled={submitting || isRunning || selectedTargets.size === 0}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      {submitting ? "Starting..." : `Start (1 -> ${selectedTargets.size})`}
                    </Button>
                    <Button
                      onClick={handleStop}
                      disabled={submitting || !isRunning}
                      variant="ghost"
                      className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Square className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Status — only show when running or has data */}
      {status && (status.running || status.targets.length > 0) && (
        <>
          {/* Summary bar */}
          <Card className="border-zinc-700 bg-zinc-900">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-sm text-zinc-400">
                    Source: <span className="font-mono text-zinc-200">{status.source?.login}@{status.source?.server}</span>
                  </div>
                  <span className="text-zinc-600">|</span>
                  <div className="text-sm text-zinc-400">
                    Positions: <span className="text-zinc-200">{status.sourcePositions}</span>
                  </div>
                  <span className="text-zinc-600">|</span>
                  <div className="text-sm text-zinc-400">
                    x<span className="text-zinc-200">{status.volumeMult}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {status.summary.failed > 0 ? (
                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                      {status.summary.synced}/{status.summary.total} synced ({status.summary.failed} failed)
                    </Badge>
                  ) : status.summary.total > 0 ? (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      {status.summary.synced}/{status.summary.total} synced
                    </Badge>
                  ) : (
                    <Badge className="bg-zinc-700/50 text-zinc-400 border-zinc-600">
                      {status.summary.targetCount} target(s) — waiting for trades
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Target status table */}
          <Card className="border-zinc-700 bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-zinc-100">Targets</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 text-left text-zinc-400">
                      <th className="px-4 py-2 font-medium"></th>
                      <th className="px-4 py-2 font-medium">Account</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Synced</th>
                      <th className="px-4 py-2 font-medium">Last Sync</th>
                      <th className="px-4 py-2 font-medium">Last Error</th>
                      <th className="px-4 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.targets.map((t) => {
                      const acct = findAccountByKey(t.key);
                      const vpsName = acct?.vpsName ?? "";
                      const isExpanded = expandedTarget === t.key;
                      return (
                        <>
                          <tr
                            key={t.key}
                            className="border-b border-zinc-800 hover:bg-zinc-800/50 cursor-pointer"
                            onClick={() => setExpandedTarget(isExpanded ? null : t.key)}
                          >
                            <td className="px-4 py-2 text-zinc-500">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <span className="font-mono text-zinc-200">
                                {t.login}@{t.server}
                              </span>
                              {vpsName && (
                                <span className="ml-2 text-xs text-zinc-500">({vpsName})</span>
                              )}
                              <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                t.mode === "follow"
                                  ? "bg-blue-500/20 text-blue-400"
                                  : "bg-orange-500/20 text-orange-400"
                              }`}>
                                {t.mode}
                              </span>
                            </td>
                            <td className="px-4 py-2">{targetStatusIcon(t)}</td>
                            <td className="px-4 py-2">{targetStatusBadge(t)}</td>
                            <td className="px-4 py-2 text-zinc-400">{timeSince(t.lastSyncedAt)}</td>
                            <td className="max-w-[200px] truncate px-4 py-2 text-xs text-red-400">
                              {t.lastError ?? ""}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-1">
                                {t.failed > 0 && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
                                    disabled={retrying === t.key}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRetry(t.key);
                                    }}
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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveTarget(t.key);
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${t.key}-log`}>
                              <td colSpan={7} className="bg-black/50 px-4 py-2">
                                <div className="max-h-[200px] overflow-auto rounded bg-black p-3 font-mono text-xs">
                                  {t.log.length > 0 ? (
                                    t.log.map((entry, i) => (
                                      <div key={i} className="whitespace-pre-wrap">
                                        <span className="text-zinc-600">{entry.time}</span>{" "}
                                        <span className={logColor(entry.action)}>
                                          [{entry.action}]
                                        </span>{" "}
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
                    })}
                  </tbody>
                </table>
              </div>
              {/* Add target while running */}
              {isRunning && addableAccounts.length > 0 && (
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
            </CardContent>
          </Card>

          {/* Global activity log */}
          <Card className="border-zinc-700 bg-zinc-900">
            <CardHeader>
              <CardTitle className="text-zinc-100">Activity Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[300px] overflow-auto rounded bg-black p-4 font-mono text-sm">
                {status.log && status.log.length > 0 ? (
                  status.log.map((entry, i) => (
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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
