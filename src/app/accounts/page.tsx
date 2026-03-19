"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { Trash2 } from "lucide-react";
import { formatCurrency, formatProfit, profitColor } from "@/lib/format";

interface AccountRow {
  vpsId: string;
  vpsName: string;
  login: string;
  server: string;
  balance: number;
  equity: number;
  profit: number;
  connected: boolean;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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
  }, []);

  async function handleDelete(account: AccountRow) {
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
      <h1 className="text-2xl font-bold text-zinc-100">All Accounts</h1>

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
              <TableHead className="text-zinc-400">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow className="border-zinc-700">
                <TableCell colSpan={8} className="text-center text-zinc-500 py-8">
                  No accounts found across any VPS.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((account) => (
                <TableRow
                  key={`${account.vpsId}-${account.server}-${account.login}`}
                  className="border-zinc-700 hover:bg-zinc-800/50"
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
                    {account.connected ? (
                      <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Connected</Badge>
                    ) : (
                      <Badge className="bg-red-500/20 text-red-500 border-red-500/30">Disconnected</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Link href={`/accounts/${account.vpsId}/${account.server}/${account.login}`}>
                        <Button variant="ghost" size="sm" className="text-blue-500 hover:text-blue-400 hover:bg-blue-500/10">
                          View
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting === `${account.vpsId}-${account.server}-${account.login}`}
                        onClick={() => handleDelete(account)}
                        className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
