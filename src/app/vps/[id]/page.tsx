"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Play } from "lucide-react";
import { formatCurrency, formatProfit, profitColor } from "@/lib/format";

interface Account {
  login: string;
  server: string;
  balance: number;
  equity: number;
  profit: number;
  connected: boolean;
}

interface VpsDetail {
  id: string;
  name: string;
  ip: string;
  status: "ONLINE" | "OFFLINE" | "PENDING" | "ERROR";
  vncIp: string;
  vncPort: number;
  accounts: Account[];
}

function statusBadge(status: string) {
  switch (status) {
    case "ONLINE":
      return <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">ONLINE</Badge>;
    case "OFFLINE":
      return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">OFFLINE</Badge>;
    case "PENDING":
      return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">PENDING</Badge>;
    case "ERROR":
      return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">ERROR</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function VpsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [vps, setVps] = useState<VpsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [accountForm, setAccountForm] = useState({
    login: "",
    password: "",
    server: "",
    broker: "",
    installerUrl: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function fetchVps() {
    try {
      const res = await fetch(`/api/vps/${id}`);
      if (!res.ok) throw new Error("Failed to fetch VPS");
      const json = await res.json();
      setVps(json);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchVps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: accountForm.login,
          password: accountForm.password,
          server: accountForm.server,
          broker: accountForm.broker || undefined,
          installerUrl: accountForm.installerUrl || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add account");
      }
      toast.success("Account added successfully");
      setDialogOpen(false);
      setAccountForm({ login: "", password: "", server: "", broker: "", installerUrl: "" });
      fetchVps();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add account");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/vps/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete VPS");
      toast.success("VPS deleted");
      router.push("/vps");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete VPS");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-400">Loading VPS details...</p>
      </div>
    );
  }

  if (error || !vps) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-red-500">Error: {error || "VPS not found"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">{vps.name}</h1>
            {statusBadge(vps.status)}
          </div>
          <p className="text-sm text-zinc-400 font-mono">{vps.ip}</p>
        </div>
        <div className="flex gap-2">
          {(vps.status === "PENDING" || vps.status === "ERROR") && (
            <Link href={`/vps/${id}/provision`}>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                <Play className="mr-2 h-4 w-4" />
                Provision
              </Button>
            </Link>
          )}
          {!deleteConfirm ? (
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirm(true)}
              className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete VPS
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Confirm Delete
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDeleteConfirm(false)}
                className="text-zinc-400"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-zinc-100">Accounts</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" />
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Account
            </DialogTrigger>
            <DialogContent className="border-zinc-700 bg-zinc-900">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">Add Account</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddAccount} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-zinc-300">Login</Label>
                  <Input
                    value={accountForm.login}
                    onChange={(e) => setAccountForm((p) => ({ ...p, login: e.target.value }))}
                    required
                    className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    placeholder="e.g. 26107909"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Password</Label>
                  <Input
                    type="password"
                    value={accountForm.password}
                    onChange={(e) => setAccountForm((p) => ({ ...p, password: e.target.value }))}
                    required
                    className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Server</Label>
                  <Input
                    value={accountForm.server}
                    onChange={(e) => setAccountForm((p) => ({ ...p, server: e.target.value }))}
                    required
                    className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    placeholder="e.g. FivePercentOnline-Real"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Broker (optional)</Label>
                  <Input
                    value={accountForm.broker}
                    onChange={(e) => setAccountForm((p) => ({ ...p, broker: e.target.value }))}
                    className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    placeholder="e.g. FivePercentOnline"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Installer URL (optional)</Label>
                  <Input
                    value={accountForm.installerUrl}
                    onChange={(e) => setAccountForm((p) => ({ ...p, installerUrl: e.target.value }))}
                    className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                    placeholder="https://download.mql5.com/cdn/web/..."
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {submitting ? "Adding..." : "Add Account"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDialogOpen(false)}
                    className="text-zinc-400"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-700 hover:bg-transparent">
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
              {vps.accounts.length === 0 ? (
                <TableRow className="border-zinc-700">
                  <TableCell colSpan={7} className="text-center text-zinc-500 py-8">
                    No accounts configured on this VPS.
                  </TableCell>
                </TableRow>
              ) : (
                vps.accounts.map((account) => (
                  <TableRow key={`${account.server}-${account.login}`} className="border-zinc-700 hover:bg-zinc-800/50">
                    <TableCell className="font-mono text-zinc-200">{account.login}</TableCell>
                    <TableCell className="text-zinc-300">{account.server}</TableCell>
                    <TableCell className="text-zinc-200">{formatCurrency(account.balance)}</TableCell>
                    <TableCell className="text-zinc-200">{formatCurrency(account.equity)}</TableCell>
                    <TableCell className={profitColor(account.profit)}>{formatProfit(account.profit)}</TableCell>
                    <TableCell>
                      {account.connected ? (
                        <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Connected</Badge>
                      ) : (
                        <Badge className="bg-red-500/20 text-red-500 border-red-500/30">Disconnected</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/accounts/${id}/${account.server}/${account.login}`}>
                        <Button variant="ghost" size="sm" className="text-blue-500 hover:text-blue-400 hover:bg-blue-500/10">
                          View
                        </Button>
                      </Link>
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
