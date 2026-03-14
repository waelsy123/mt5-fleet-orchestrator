"use client";

import { useEffect, useState, use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { formatCurrency, formatProfit, profitColor } from "@/lib/format";

interface AccountInfo {
  login: string;
  server: string;
  balance: number;
  equity: number;
  profit: number;
  freeMargin: number;
  leverage: number;
  connected: boolean;
  vpsName: string;
}

interface Position {
  ticket: string;
  symbol: string;
  type: "BUY" | "SELL";
  volume: number;
  openPrice: number;
  profit: number;
  sl: number;
  tp: number;
}

export default function AccountDetailPage({
  params,
}: {
  params: Promise<{ vpsId: string; server: string; login: string }>;
}) {
  const { vpsId, server, login } = use(params);
  const decodedServer = decodeURIComponent(server);

  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingTicket, setClosingTicket] = useState<string | null>(null);

  async function fetchData() {
    try {
      const [accRes, posRes] = await Promise.all([
        fetch(`/api/accounts/${vpsId}/${encodeURIComponent(decodedServer)}/${login}`),
        fetch(`/api/accounts/${vpsId}/${encodeURIComponent(decodedServer)}/${login}/positions`),
      ]);
      if (!accRes.ok) throw new Error("Failed to fetch account info");
      const accData = await accRes.json();
      setAccount(accData);

      if (posRes.ok) {
        const posData = await posRes.json();
        setPositions(posData);
      }
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vpsId, server, login]);

  async function handleClose(symbol: string, ticket: string) {
    setClosingTicket(ticket);
    try {
      const res = await fetch(
        `/api/accounts/${vpsId}/${encodeURIComponent(decodedServer)}/${login}/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to close position");
      }
      toast.success(`Closed position on ${symbol}`);
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to close position");
    } finally {
      setClosingTicket(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-400">Loading account details...</p>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-red-500">Error: {error || "Account not found"}</p>
      </div>
    );
  }

  const stats = [
    { label: "Balance", value: formatCurrency(account.balance) },
    { label: "Equity", value: formatCurrency(account.equity) },
    { label: "P&L", value: formatProfit(account.profit), color: profitColor(account.profit) },
    { label: "Free Margin", value: formatCurrency(account.freeMargin) },
    { label: "Leverage", value: `1:${account.leverage}` },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-100">
            Account {login}
          </h1>
          {account.connected ? (
            <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Connected</Badge>
          ) : (
            <Badge className="bg-red-500/20 text-red-500 border-red-500/30">Disconnected</Badge>
          )}
        </div>
        <p className="text-sm text-zinc-400">
          {decodedServer} &middot; {account.vpsName}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-zinc-700 bg-zinc-900">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-zinc-400">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-lg font-bold ${stat.color || "text-zinc-100"}`}>
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader>
          <CardTitle className="text-zinc-100">Open Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-700 hover:bg-transparent">
                <TableHead className="text-zinc-400">Ticket</TableHead>
                <TableHead className="text-zinc-400">Symbol</TableHead>
                <TableHead className="text-zinc-400">Type</TableHead>
                <TableHead className="text-zinc-400">Volume</TableHead>
                <TableHead className="text-zinc-400">Open Price</TableHead>
                <TableHead className="text-zinc-400">Profit</TableHead>
                <TableHead className="text-zinc-400">SL</TableHead>
                <TableHead className="text-zinc-400">TP</TableHead>
                <TableHead className="text-zinc-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.length === 0 ? (
                <TableRow className="border-zinc-700">
                  <TableCell colSpan={9} className="text-center text-zinc-500 py-8">
                    No open positions.
                  </TableCell>
                </TableRow>
              ) : (
                positions.map((pos) => (
                  <TableRow key={pos.ticket} className="border-zinc-700 hover:bg-zinc-800/50">
                    <TableCell className="font-mono text-zinc-300 text-sm">{pos.ticket}</TableCell>
                    <TableCell className="font-medium text-zinc-200">{pos.symbol}</TableCell>
                    <TableCell>
                      <span
                        className={
                          pos.type === "BUY"
                            ? "font-semibold text-emerald-500"
                            : "font-semibold text-red-500"
                        }
                      >
                        {pos.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-300">{pos.volume}</TableCell>
                    <TableCell className="text-zinc-300">{pos.openPrice}</TableCell>
                    <TableCell className={profitColor(pos.profit)}>
                      {formatProfit(pos.profit)}
                    </TableCell>
                    <TableCell className="text-zinc-400">{pos.sl || "-"}</TableCell>
                    <TableCell className="text-zinc-400">{pos.tp || "-"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={closingTicket === pos.ticket}
                        onClick={() => handleClose(pos.symbol, pos.ticket)}
                        className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      >
                        {closingTicket === pos.ticket ? "Closing..." : "Close"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
