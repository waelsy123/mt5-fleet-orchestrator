"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Trash2, Search } from "lucide-react";
import { formatCurrency, formatProfit, profitColor } from "@/lib/format";

interface AccountRow {
  vpsId: string;
  vpsName: string;
  login: string;
  server: string;
  status: "SETUP" | "ACTIVE" | "FAILED";
  balance: number;
  equity: number;
  profit: number;
  connected: boolean;
  lastSynced: string | null;
}

function timeAgo(dateStr: string): string {
  const sec = Math.round((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const router = useRouter();

  const filtered = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(
      (a) =>
        a.login.toLowerCase().includes(q) ||
        a.server.toLowerCase().includes(q) ||
        a.vpsName.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  async function fetchAccounts() {
    try {
      const res = await fetch("/api/accounts");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      const json = await res.json();
      setAccounts(json);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAccounts();
    const interval = setInterval(fetchAccounts, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function handleDelete(e: React.MouseEvent, account: AccountRow) {
    e.stopPropagation();
    const confirmed = window.confirm(
      `Delete account ${account.login}@${account.server} from ${account.vpsName}?\n\nThis will stop the MT5 terminal and delete all account files on the VPS.`
    );
    if (!confirmed) return;

    const key = `${account.vpsId}-${account.server}-${account.login}`;
    setDeleting(key);
    try {
      const res = await fetch(
        `/api/accounts/${account.vpsId}/${encodeURIComponent(account.server)}/${account.login}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to delete (HTTP ${res.status})`);
      }
      toast.success(`Account ${account.login} deleted`);
      fetchAccounts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-400">Loading accounts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">All Accounts</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search login, server, VPS..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
          />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-900">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-700 hover:bg-transparent">
              <TableHead className="text-zinc-400">VPS</TableHead>
              <TableHead className="text-zinc-400">Login</TableHead>
              <TableHead className="text-zinc-400">Server</TableHead>
              <TableHead className="text-zinc-400">Balance</TableHead>
              <TableHead className="text-zinc-400">Equity</TableHead>
              <TableHead className="text-zinc-400">P&L</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400">Last Update</TableHead>
              <TableHead className="text-zinc-400"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="border-zinc-700">
                <TableCell colSpan={9} className="text-center text-zinc-500 py-8">
                  {accounts.length === 0
                    ? "No accounts found across any VPS."
                    : "No accounts match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((account) => {
                const key = `${account.vpsId}-${account.server}-${account.login}`;
                return (
                  <TableRow
                    key={key}
                    className="border-zinc-700 hover:bg-zinc-800/50 cursor-pointer"
                    onClick={() => router.push(`/accounts/${account.vpsId}/${account.server}/${account.login}`)}
                  >
                    <TableCell className="text-zinc-200">{account.vpsName}</TableCell>
                    <TableCell className="font-mono text-zinc-200">{account.login}</TableCell>
                    <TableCell className="text-zinc-300">{account.server}</TableCell>
                    <TableCell className="text-zinc-200">{formatCurrency(account.balance)}</TableCell>
                    <TableCell className="text-zinc-200">{formatCurrency(account.equity)}</TableCell>
                    <TableCell className={profitColor(account.profit)}>
                      {formatProfit(account.profit)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {account.status === "SETUP" ? (
                          <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">Setting up...</Badge>
                        ) : account.status === "FAILED" ? (
                          <Badge className="bg-red-500/20 text-red-500 border-red-500/30">Setup Failed</Badge>
                        ) : account.connected ? (
                          <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Connected</Badge>
                        ) : (
                          <Badge className="bg-red-500/20 text-red-500 border-red-500/30">Disconnected</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">
                      {account.lastSynced ? timeAgo(account.lastSynced) : "--"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting === key}
                        onClick={(e) => handleDelete(e, account)}
                        className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
