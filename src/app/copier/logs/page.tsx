"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Filter } from "lucide-react";

interface LogEntry {
  id: string;
  sessionId: string;
  targetKey: string | null;
  action: string;
  detail: string;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
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

function actionColor(action: string) {
  return ACTION_COLORS[action] ?? "text-green-400";
}

function actionBadgeClass(action: string) {
  if (action === "FAIL" || action === "ERROR") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (action === "COPIED") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (action === "NEW" || action === "CLOSED" || action === "PARTIAL") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (action === "START" || action === "RESTORE" || action === "ADD_TARGET") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  return "bg-zinc-700/50 text-zinc-400 border-zinc-600";
}

const ALL_ACTIONS = [
  "START", "STOP", "NEW", "CLOSED", "COPIED", "PARTIAL",
  "FAIL", "ERROR", "WARN", "SKIP", "SNAPSHOT", "RESTORE",
  "ADD_TARGET", "REMOVE_TARGET",
];

export default function CopierLogsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><p className="text-zinc-400">Loading...</p></div>}>
      <CopierLogsContent />
    </Suspense>
  );
}

function CopierLogsContent() {
  const searchParams = useSearchParams();
  const initialSessionId = searchParams.get("sessionId") || "";

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sessionFilter, setSessionFilter] = useState(initialSessionId);
  const [actionFilter, setActionFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const fetchLogs = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams();
    if (sessionFilter) params.set("sessionId", sessionFilter);
    if (actionFilter) params.set("action", actionFilter);
    params.set("limit", "100");
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`/api/copier/logs?${params}`);
    if (!res.ok) throw new Error("Failed to fetch logs");
    return res.json();
  }, [sessionFilter, actionFilter]);

  useEffect(() => {
    setLoading(true);
    fetchLogs()
      .then((data) => {
        setLogs(data.logs);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchLogs]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchLogs(nextCursor);
      setLogs((prev) => [...prev, ...data.logs]);
      setNextCursor(data.nextCursor);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }

  // Unique sessions for filter dropdown
  const sessionIds = [...new Set(logs.map((l) => l.sessionId))];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/copier" className="text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-zinc-100">Copier Log</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="text-zinc-400 hover:text-zinc-200"
        >
          <Filter className="mr-1 h-4 w-4" />
          Filters
        </Button>
      </div>

      {showFilters && (
        <Card className="border-zinc-700 bg-zinc-900">
          <CardContent className="flex flex-wrap items-center gap-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Session:</span>
              <select
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
              >
                <option value="">All sessions</option>
                {sessionIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Action:</span>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
              >
                <option value="">All actions</option>
                {ALL_ACTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            {(sessionFilter || actionFilter) && (
              <button
                onClick={() => { setSessionFilter(""); setActionFilter(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Clear filters
              </button>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-zinc-400">
              {loading ? "Loading..." : `${logs.length} log entries${nextCursor ? " (more available)" : ""}`}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length === 0 && !loading ? (
            <div className="py-8 text-center text-zinc-500">
              No log entries found.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-700 text-left text-zinc-500">
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Session</th>
                    <th className="px-4 py-2 font-medium">Target</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-zinc-500">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-zinc-400">
                        {log.sessionId}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-zinc-400">
                        {log.targetKey ?? "--"}
                      </td>
                      <td className="px-4 py-2">
                        <Badge className={`text-xs ${actionBadgeClass(log.action)}`}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className={`max-w-[400px] truncate px-4 py-2 text-xs ${actionColor(log.action)}`} title={log.detail}>
                        {log.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nextCursor && (
            <div className="border-t border-zinc-700 px-4 py-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <ChevronDown className="mr-1 h-4 w-4" />
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
