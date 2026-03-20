"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Wifi,
  WifiOff,
  Users,
  DollarSign,
  TrendingUp,
  Copy,
  AlertTriangle,
  XCircle,
  ArrowUpRight,
  Activity,
  ChevronRight,
  CircleDot,
} from "lucide-react";
import { formatCurrency, formatProfit, profitColor } from "@/lib/format";

interface VpsSummary {
  id: string;
  name: string;
  ip: string;
  status: "ONLINE" | "OFFLINE" | "PENDING" | "ERROR";
  accountCount: number;
  totalEquity: number;
  totalProfit: number;
}

interface Alert {
  type: string;
  message: string;
  vpsId?: string;
  vpsName?: string;
  login?: string;
  server?: string;
}

interface CopierInfo {
  id: string;
  source: { vpsId: string; server: string; login: string } | null;
  targetCount: number;
  sourcePositions: number;
  synced: number;
  failed: number;
}

interface RecentLog {
  id: string;
  sessionId: string;
  targetKey: string | null;
  action: string;
  detail: string;
  createdAt: string;
}

interface DashboardData {
  totalVps: number;
  onlineVps: number;
  totalAccounts: number;
  totalEquity: number;
  totalProfit: number;
  activeSessions: number;
  activeTrades: number;
  failedTrades: number;
  copierInfo: CopierInfo[];
  recentLogs: RecentLog[];
  alerts: Alert[];
  vps: VpsSummary[];
}

function statusDot(status: string) {
  switch (status) {
    case "ONLINE":
      return <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>;
    case "OFFLINE":
      return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />;
    case "ERROR":
      return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />;
    case "PENDING":
      return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-yellow-500" />;
    default:
      return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-zinc-500" />;
  }
}

const LOG_COLORS: Record<string, string> = {
  START: "text-blue-400",
  STOP: "text-zinc-500",
  NEW: "text-yellow-400",
  CLOSED: "text-yellow-400",
  COPIED: "text-emerald-400",
  PARTIAL: "text-cyan-400",
  FAIL: "text-red-400",
  ERROR: "text-red-400",
  WARN: "text-orange-400",
  SKIP: "text-zinc-500",
  SNAPSHOT: "text-zinc-500",
  RESTORE: "text-blue-400",
  ADD_TARGET: "text-blue-400",
  REMOVE_TARGET: "text-orange-400",
};

function logColor(action: string) {
  return LOG_COLORS[action] ?? "text-zinc-400";
}

function timeAgo(dateStr: string) {
  const sec = Math.round((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) throw new Error("Failed to fetch dashboard");
        const json = await res.json();
        setData(json);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
    const interval = setInterval(fetchDashboard, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
          <p className="text-sm text-zinc-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <XCircle className="h-8 w-8 text-red-500" />
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const offlineCount = data.totalVps - data.onlineVps;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">Fleet overview and monitoring</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-600">
          <Activity className="h-3 w-3" />
          Live — refreshes every 10s
        </div>
      </div>

      {/* Alerts banner */}
      {data.alerts.length > 0 && (
        <div className="rounded-xl border border-red-500/20 bg-gradient-to-r from-red-500/5 to-orange-500/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-sm font-medium text-red-400">{data.alerts.length} active alert{data.alerts.length > 1 ? "s" : ""}</span>
          </div>
          <div className="space-y-2">
            {data.alerts.map((alert, i) => (
              <Link
                key={i}
                href={
                  alert.type === "account_disconnected" && alert.vpsId && alert.login && alert.server
                    ? `/accounts/${alert.vpsId}/${alert.server}/${alert.login}`
                    : alert.vpsId
                      ? `/vps/${alert.vpsId}`
                      : "#"
                }
                className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5"
              >
                {alert.type === "vps_offline" ? (
                  <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
                )}
                <span className={`flex-1 text-sm ${alert.type === "vps_offline" ? "text-red-300/80" : "text-yellow-300/80"}`}>
                  {alert.message}
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-zinc-600 transition-colors group-hover:text-zinc-400" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Total Equity — hero card */}
        <Link href="/accounts" className="col-span-2 lg:col-span-1">
          <div className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-900/50 p-5 transition-all hover:border-zinc-700 hover:shadow-lg hover:shadow-emerald-500/5">
            <div className="absolute right-3 top-3 rounded-lg bg-emerald-500/10 p-2">
              <DollarSign className="h-5 w-5 text-emerald-500" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Total Equity</p>
            <p className="mt-2 text-3xl font-bold text-zinc-100">{formatCurrency(data.totalEquity)}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <TrendingUp className={`h-3.5 w-3.5 ${data.totalProfit >= 0 ? "text-emerald-500" : "text-red-500"}`} />
              <span className={`text-sm font-medium ${profitColor(data.totalProfit)}`}>
                {formatProfit(data.totalProfit)}
              </span>
              <span className="text-xs text-zinc-600">P&L</span>
            </div>
          </div>
        </Link>

        {/* VPS */}
        <Link href="/vps">
          <div className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 transition-all hover:border-zinc-700 hover:shadow-lg hover:shadow-blue-500/5">
            <div className="absolute right-3 top-3 rounded-lg bg-blue-500/10 p-2">
              <Server className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">VPS Fleet</p>
            <p className="mt-2 text-3xl font-bold text-zinc-100">{data.totalVps}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-emerald-500">
                <Wifi className="h-3 w-3" /> {data.onlineVps}
              </span>
              {offlineCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <WifiOff className="h-3 w-3" /> {offlineCount}
                </span>
              )}
            </div>
          </div>
        </Link>

        {/* Accounts */}
        <Link href="/accounts">
          <div className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 transition-all hover:border-zinc-700 hover:shadow-lg hover:shadow-blue-500/5">
            <div className="absolute right-3 top-3 rounded-lg bg-blue-500/10 p-2">
              <Users className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Accounts</p>
            <p className="mt-2 text-3xl font-bold text-zinc-100">{data.totalAccounts}</p>
            <p className="mt-2 text-xs text-zinc-600">Across {data.totalVps} server{data.totalVps !== 1 ? "s" : ""}</p>
          </div>
        </Link>

        {/* Copier */}
        <Link href="/copier">
          <div className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 transition-all hover:border-zinc-700 hover:shadow-lg hover:shadow-blue-500/5">
            <div className="absolute right-3 top-3 rounded-lg bg-blue-500/10 p-2">
              <Copy className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Copy Trading</p>
            <p className="mt-2 text-3xl font-bold text-zinc-100">{data.activeSessions}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-zinc-500">{data.activeTrades} synced</span>
              {data.failedTrades > 0 && (
                <span className="text-xs text-red-400">{data.failedTrades} failed</span>
              )}
            </div>
          </div>
        </Link>
      </div>

      {/* Two columns: Copier sessions + Recent activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Active copier sessions */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Active Sessions</h2>
            <Link href="/copier" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              View all <ChevronRight className="inline h-3 w-3" />
            </Link>
          </div>
          {data.copierInfo.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-10 text-center">
              <Copy className="mb-2 h-6 w-6 text-zinc-700" />
              <p className="text-sm text-zinc-600">No active copier sessions</p>
              <Link href="/copier" className="mt-2 text-xs text-blue-500 hover:text-blue-400 transition-colors">
                Start a session
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {data.copierInfo.map((s) => (
                <Link key={s.id} href={`/copier/trades?sessionId=${encodeURIComponent(s.id)}`}>
                  <div className="group rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-800/60">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                          <Activity className="h-4 w-4 text-emerald-500" />
                        </div>
                        <div>
                          <p className="font-mono text-sm text-zinc-200">
                            {s.source?.login}
                            <span className="text-zinc-600">@</span>
                            <span className="text-zinc-400">{s.source?.server}</span>
                          </p>
                          <p className="text-xs text-zinc-600">{s.id}</p>
                        </div>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-zinc-700 transition-colors group-hover:text-zinc-400" />
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-xs">
                      <span className="text-zinc-500">{s.targetCount} target{s.targetCount !== 1 ? "s" : ""}</span>
                      <span className="text-zinc-500">{s.sourcePositions} position{s.sourcePositions !== 1 ? "s" : ""}</span>
                      {s.synced > 0 && (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px]">
                          {s.synced} synced
                        </Badge>
                      )}
                      {s.failed > 0 && (
                        <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[10px]">
                          {s.failed} failed
                        </Badge>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Recent Copier Activity</h2>
            <Link href="/copier/logs" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              View all <ChevronRight className="inline h-3 w-3" />
            </Link>
          </div>
          {data.recentLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-10 text-center">
              <CircleDot className="mb-2 h-6 w-6 text-zinc-700" />
              <p className="text-sm text-zinc-600">No copier activity yet</p>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 divide-y divide-zinc-800/80">
              {data.recentLogs.map((log) => (
                <Link
                  key={log.id}
                  href={`/copier/logs?sessionId=${encodeURIComponent(log.sessionId)}`}
                  className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/50"
                >
                  <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                    log.action === "COPIED" ? "bg-emerald-500/15 text-emerald-400" :
                    log.action === "FAIL" || log.action === "ERROR" ? "bg-red-500/15 text-red-400" :
                    log.action === "NEW" || log.action === "CLOSED" ? "bg-yellow-500/15 text-yellow-400" :
                    log.action === "START" ? "bg-blue-500/15 text-blue-400" :
                    "bg-zinc-800 text-zinc-500"
                  }`}>
                    {log.action.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${logColor(log.action)}`}>
                      {log.detail}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      {log.sessionId}
                      {log.targetKey && <span className="ml-1.5 text-zinc-700">/ {log.targetKey}</span>}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-zinc-700">{timeAgo(log.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* VPS Fleet grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">VPS Fleet</h2>
          <Link href="/vps" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            Manage <ChevronRight className="inline h-3 w-3" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.vps.map((vps) => (
            <Link key={vps.id} href={`/vps/${vps.id}`}>
              <div className="group rounded-xl border border-zinc-800 bg-zinc-900/80 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-800/60 hover:shadow-lg hover:shadow-zinc-900/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {statusDot(vps.status)}
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">{vps.name}</p>
                      <p className="font-mono text-xs text-zinc-600">{vps.ip}</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-zinc-800 transition-colors group-hover:text-zinc-500" />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Accounts</p>
                    <p className="mt-0.5 text-lg font-semibold text-zinc-300">{vps.accountCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Equity</p>
                    <p className="mt-0.5 text-lg font-semibold text-zinc-300">{formatCurrency(vps.totalEquity)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">P&L</p>
                    <p className={`mt-0.5 text-lg font-semibold ${profitColor(vps.totalProfit)}`}>
                      {formatProfit(vps.totalProfit)}
                    </p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
