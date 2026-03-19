"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Crown,
  Users,
} from "lucide-react";

interface TargetPosition {
  ticket: string;
  symbol: string;
  type: string;
  volume: string;
  price: string;
  profit: string;
}

interface TargetTrade {
  targetKey: string;
  login: string;
  server: string;
  mode: string;
  volumeMult: number;
  position: TargetPosition | null;
  mirrorStatus: string;
  mirrorError?: string;
}

interface MasterTrade {
  ticket: string;
  symbol: string;
  type: string;
  volume: string;
  price: string;
  profit: string;
  targets: TargetTrade[];
}

interface TargetInfo {
  key: string;
  login: string;
  server: string;
  mode: string;
  volumeMult: number;
}

interface TradesData {
  sessionId: string;
  source: { login: string; server: string; vpsId: string };
  targets: TargetInfo[];
  trades: MasterTrade[];
  totalSourcePositions: number;
  trackedPositions: number;
}

export default function TradesPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl py-8 text-center text-zinc-500">Loading...</div>}>
      <TradesPageInner />
    </Suspense>
  );
}

function TradesPageInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");
  const [data, setData] = useState<TradesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTrades = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/copier/trades?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError("Failed to fetch trades");
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTrades();
    pollRef.current = setInterval(fetchTrades, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchTrades]);

  function toggleTrade(ticket: string) {
    setExpandedTrades((prev) => {
      const next = new Set(prev);
      if (next.has(ticket)) next.delete(ticket);
      else next.add(ticket);
      return next;
    });
  }

  function expandAll() {
    if (!data) return;
    setExpandedTrades(new Set(data.trades.map((t) => t.ticket)));
  }

  function collapseAll() {
    setExpandedTrades(new Set());
  }

  if (!sessionId) {
    return (
      <div className="mx-auto max-w-5xl py-8 text-center text-zinc-500">
        No session ID provided.{" "}
        <Link href="/copier" className="text-blue-400 hover:underline">Go back</Link>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Link href="/copier" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Back to Copy Trading
        </Link>
        <Card className="border-red-500/30 bg-zinc-900">
          <CardContent className="py-8 text-center text-red-400">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Link href="/copier" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Back to Copy Trading
        </Link>
        <div className="py-8 text-center text-zinc-500">Loading...</div>
      </div>
    );
  }

  const totalTargetProfit = data.trades.reduce((sum, t) => {
    return sum + t.targets.reduce((s, tgt) => {
      return s + (tgt.position ? parseFloat(tgt.position.profit) : 0);
    }, 0);
  }, 0);

  const totalSourceProfit = data.trades.reduce((s, t) => s + parseFloat(t.profit), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/copier" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Back to Copy Trading
        </Link>
        <span className="text-xs text-zinc-600">{data.sessionId}</span>
      </div>

      {/* Header */}
      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crown className="h-5 w-5 text-yellow-400" />
              <CardTitle className="text-zinc-100">
                <span className="font-mono">{data.source.login}</span>
                <span className="mx-2 text-zinc-500">@</span>
                <span className="text-zinc-400">{data.source.server}</span>
              </CardTitle>
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Master</Badge>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-zinc-400">
                Tracked: <span className="text-zinc-200">{data.trades.length}</span>
              </span>
              <span className="text-zinc-400">
                Total: <span className="text-zinc-200">{data.totalSourcePositions}</span>
              </span>
              <span className={totalSourceProfit >= 0 ? "text-emerald-400" : "text-red-400"}>
                P/L: ${totalSourceProfit.toFixed(2)}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            {data.targets.map((t) => (
              <div
                key={t.key}
                className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5"
              >
                <Users className="h-3 w-3 text-blue-400" />
                <span className="font-mono text-xs text-zinc-200">{t.login}</span>
                <span className="text-xs text-zinc-500">@{t.server}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  t.mode === "follow"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-orange-500/20 text-orange-400"
                }`}>
                  {t.mode}
                </span>
                <span className="text-[10px] text-zinc-500">x{t.volumeMult}</span>
              </div>
            ))}
          </div>
          {data.targets.length > 0 && (
            <div className="mt-2 text-xs text-zinc-500">
              Total target P/L:{" "}
              <span className={totalTargetProfit >= 0 ? "text-emerald-400" : "text-red-400"}>
                ${totalTargetProfit.toFixed(2)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trades */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-400">Live Positions</h2>
        <div className="flex gap-2">
          <button onClick={expandAll} className="text-xs text-blue-400 hover:text-blue-300">Expand all</button>
          <span className="text-xs text-zinc-600">|</span>
          <button onClick={collapseAll} className="text-xs text-zinc-400 hover:text-zinc-300">Collapse all</button>
        </div>
      </div>

      {data.trades.length === 0 ? (
        <Card className="border-zinc-700 bg-zinc-900">
          <CardContent className="py-8 text-center text-zinc-500">
            No tracked positions. New trades from the master will appear here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.trades.map((trade) => (
            <TradeCard
              key={trade.ticket}
              trade={trade}
              expanded={expandedTrades.has(trade.ticket)}
              onToggle={() => toggleTrade(trade.ticket)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TradeCard({
  trade,
  expanded,
  onToggle,
}: {
  trade: MasterTrade;
  expanded: boolean;
  onToggle: () => void;
}) {
  const profit = parseFloat(trade.profit);
  const allSynced = trade.targets.every((t) => t.position || t.mirrorStatus === "synced");
  const anyFailed = trade.targets.some((t) => t.mirrorStatus === "failed");

  return (
    <Card className="border-zinc-700 bg-zinc-900 overflow-hidden">
      {/* Master row */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <span className="text-zinc-500">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <Crown className="h-4 w-4 text-yellow-400 shrink-0" />
        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
          trade.type === "BUY"
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-red-500/20 text-red-400"
        }`}>
          {trade.type}
        </span>
        <span className="font-mono text-sm text-zinc-200">{trade.volume}</span>
        <span className="font-medium text-zinc-100">{trade.symbol}</span>
        <span className="text-xs text-zinc-500">@ {trade.price}</span>
        <span className="text-xs text-zinc-500">#{trade.ticket}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className={`font-mono text-sm ${profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {profit >= 0 ? "+" : ""}{profit.toFixed(2)}
          </span>
          {anyFailed ? (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">
              {trade.targets.filter((t) => t.mirrorStatus === "failed").length} failed
            </Badge>
          ) : allSynced ? (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
              {trade.targets.length}/{trade.targets.length}
            </Badge>
          ) : (
            <Badge className="bg-zinc-700/50 text-zinc-400 border-zinc-600 text-[10px]">
              {trade.targets.filter((t) => t.position).length}/{trade.targets.length}
            </Badge>
          )}
        </span>
      </button>

      {/* Target rows */}
      {expanded && (
        <div className="border-t border-zinc-800">
          {trade.targets.map((tgt) => (
            <TargetTradeRow key={tgt.targetKey} tgt={tgt} masterType={trade.type} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TargetTradeRow({
  tgt,
  masterType,
}: {
  tgt: TargetTrade;
  masterType: string;
}) {
  const expectedType = tgt.mode === "opposite"
    ? (masterType === "BUY" ? "SELL" : "BUY")
    : masterType;

  if (tgt.position) {
    const profit = parseFloat(tgt.position.profit);
    return (
      <div className="flex items-center gap-3 border-b border-zinc-800/50 px-4 py-2 pl-12 hover:bg-zinc-800/30">
        <ArrowRightLeft className="h-3 w-3 text-zinc-600 shrink-0" />
        <span className="font-mono text-xs text-zinc-400 w-24 shrink-0">{tgt.login}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
          tgt.position.type === "BUY"
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-red-500/20 text-red-400"
        }`}>
          {tgt.position.type}
        </span>
        <span className="font-mono text-xs text-zinc-300">{tgt.position.volume}</span>
        <span className="text-xs text-zinc-400">@ {tgt.position.price}</span>
        <span className="text-[10px] text-zinc-600">#{tgt.position.ticket}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
          tgt.mode === "follow"
            ? "bg-blue-500/20 text-blue-400"
            : "bg-orange-500/20 text-orange-400"
        }`}>
          {tgt.mode}
        </span>
        <span className={`ml-auto font-mono text-xs ${profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {profit >= 0 ? "+" : ""}{profit.toFixed(2)}
        </span>
      </div>
    );
  }

  // No position found on target
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800/50 px-4 py-2 pl-12 hover:bg-zinc-800/30">
      <ArrowRightLeft className="h-3 w-3 text-zinc-600 shrink-0" />
      <span className="font-mono text-xs text-zinc-400 w-24 shrink-0">{tgt.login}</span>
      {tgt.mirrorStatus === "failed" ? (
        <>
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">FAILED</Badge>
          <span className="text-xs text-red-400/70 truncate max-w-[300px]">{tgt.mirrorError}</span>
        </>
      ) : tgt.mirrorStatus === "synced" ? (
        <>
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">SYNCED</Badge>
          <span className="text-xs text-zinc-500">Position not found in snapshot</span>
        </>
      ) : (
        <Badge className="bg-zinc-700/50 text-zinc-500 border-zinc-600 text-[10px]">{tgt.mirrorStatus}</Badge>
      )}
    </div>
  );
}
