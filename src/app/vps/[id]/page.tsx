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
import { Plus, Trash2, Play, RefreshCw, Loader2, CheckCircle2, XCircle, Cpu, HardDrive, MemoryStick, Monitor, Copy } from "lucide-react";
import { formatCurrency, formatProfit, profitColor } from "@/lib/format";

interface Account {
  login: string;
  server: string;
  status: "SETUP" | "ACTIVE" | "FAILED";
  balance: number;
  equity: number;
  profit: number;
  connected: boolean;
}

interface SystemStats {
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryTotalMB: number | null;
  memoryUsedMB: number | null;
  memoryFreeMB: number | null;
  diskTotalGB: number | null;
  diskUsedGB: number | null;
  diskFreeGB: number | null;
  diskPercent: number | null;
  mt5Processes: number | null;
  uptimeSeconds: number | null;
}

interface VpsDetail {
  id: string;
  name: string;
  ip: string;
  status: "ONLINE" | "OFFLINE" | "PENDING" | "PROVISIONING" | "ERROR";
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
  const [syncing, setSyncing] = useState(false);
  const [serverResults, setServerResults] = useState<{ server: string; installer_url: string }[]>([]);
  const [serverDropdownOpen, setServerDropdownOpen] = useState(false);
  const [serverSearchTimeout, setServerSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [setupJobId, setSetupJobId] = useState<string | null>(null);
  const [setupSteps, setSetupSteps] = useState<string[]>([]);
  const [setupStatus, setSetupStatus] = useState<"idle" | "PENDING" | "SUCCESS" | "FAILED">("idle");
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [copierInfo, setCopierInfo] = useState<{ sessionId: string; role: string; login: string; server: string }[]>([]);

  async function fetchCopierInfo() {
    try {
      const res = await fetch(`/api/vps/${id}/copier-info`);
      if (res.ok) setCopierInfo(await res.json());
    } catch {
      // non-critical
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch(`/api/vps/${id}/stats`);
      if (res.ok) setStats(await res.json());
    } catch {
      // VPS might be offline
    }
  }

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
    fetchStats();
    fetchCopierInfo();
    checkRunningSetup();
    const interval = setInterval(() => {
      fetchVps();
      fetchStats();
      fetchCopierInfo();
    }, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function checkRunningSetup() {
    try {
      const res = await fetch(`/api/accounts/${id}/setup-status`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "PENDING") {
        setAccountForm((p) => ({ ...p, login: data.login || "", server: data.server || "" }));
        setSetupJobId(data.jobId);
        setSetupSteps(data.steps || []);
        setSetupStatus("PENDING");
        setDialogOpen(true);
        startSetupPolling(data.jobId);
      }
    } catch {
      // No running job
    }
  }

  function startSetupPolling(jobId: string) {
    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await fetch(
          `/api/accounts/${id}/setup-status?jobId=${jobId}`
        );
        if (!statusRes.ok) return;
        const statusData = await statusRes.json();
        setSetupSteps(statusData.steps || []);

        if (statusData.status === "SUCCESS") {
          clearInterval(pollInterval);
          setSetupStatus("SUCCESS");
          setSubmitting(false);
          toast.success(`Account ${statusData.login || accountForm.login} added!`);
          fetchVps();
        } else if (statusData.status === "FAILED") {
          clearInterval(pollInterval);
          setSetupStatus("FAILED");
          setSubmitting(false);
          toast.error(statusData.error || "Account setup failed");
        }
      } catch {
        // polling error — keep trying
      }
    }, 2000);
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSetupStatus("PENDING");
    setSetupSteps(["Submitting account setup request..."]);

    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: accountForm.login,
          password: accountForm.password,
          server: accountForm.server,
          broker: accountForm.broker || undefined,
          installer_url: accountForm.installerUrl || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start account setup");
      }
      const { jobId } = await res.json();
      setSetupJobId(jobId);
      startSetupPolling(jobId);
    } catch (err: unknown) {
      setSetupStatus("FAILED");
      setSetupSteps((prev) => [
        ...prev,
        `ERROR: ${err instanceof Error ? err.message : "Unknown error"}`,
      ]);
      setSubmitting(false);
    }
  }

  function handleServerSearch(value: string) {
    setAccountForm((p) => ({ ...p, server: value }));
    if (serverSearchTimeout) clearTimeout(serverSearchTimeout);
    if (value.length < 2) {
      setServerResults([]);
      setServerDropdownOpen(false);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/servers/search?q=${encodeURIComponent(value)}`);
        if (!res.ok) return;
        const data = await res.json();
        setServerResults(data.results || []);
        setServerDropdownOpen((data.results || []).length > 0);
      } catch {
        setServerDropdownOpen(false);
      }
    }, 300);
    setServerSearchTimeout(timeout);
  }

  function selectServer(server: string, installerUrl: string) {
    setAccountForm((p) => ({
      ...p,
      server,
      installerUrl: installerUrl || p.installerUrl,
    }));
    setServerDropdownOpen(false);
    if (installerUrl) {
      toast.success(`Installer auto-detected for ${server}`);
    }
  }

  function resetSetupDialog() {
    setDialogOpen(false);
    setSetupJobId(null);
    setSetupSteps([]);
    setSetupStatus("idle");
    setAccountForm({ login: "", password: "", server: "", broker: "", installerUrl: "" });
    setServerResults([]);
    setServerDropdownOpen(false);
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

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/vps/${id}/sync`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync accounts");
      const data = await res.json();
      toast.success(`Synced ${data.synced} account(s) from VPS`);
      fetchVps();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
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
          <Button
            onClick={handleSync}
            disabled={syncing}
            variant="ghost"
            className="text-blue-500 hover:text-blue-400 hover:bg-blue-500/10"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync Accounts"}
          </Button>
          <Link href={`/vps/${id}/provision`}>
            <Button
              className={
                vps.status === "PROVISIONING"
                  ? "bg-yellow-600 hover:bg-yellow-700 text-white animate-pulse"
                  : vps.status === "PENDING" || vps.status === "ERROR"
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              }
              variant={vps.status === "ONLINE" || vps.status === "OFFLINE" ? "ghost" : "default"}
            >
              <Play className="mr-2 h-4 w-4" />
              {vps.status === "PROVISIONING" ? "View Progress..." : "Provision"}
            </Button>
          </Link>
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

      {/* System Resources */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ResourceCard
            icon={<Cpu className="h-4 w-4" />}
            label="CPU"
            value={stats.cpuPercent != null ? `${stats.cpuPercent}%` : "--"}
            percent={stats.cpuPercent}
          />
          <ResourceCard
            icon={<MemoryStick className="h-4 w-4" />}
            label="Memory"
            value={stats.memoryUsedMB != null && stats.memoryTotalMB != null
              ? `${(stats.memoryUsedMB / 1024).toFixed(1)} / ${(stats.memoryTotalMB / 1024).toFixed(1)} GB`
              : "--"}
            percent={stats.memoryPercent}
            sub={stats.memoryFreeMB != null ? `${(stats.memoryFreeMB / 1024).toFixed(1)} GB free` : undefined}
          />
          <ResourceCard
            icon={<HardDrive className="h-4 w-4" />}
            label="Disk"
            value={stats.diskUsedGB != null && stats.diskTotalGB != null
              ? `${stats.diskUsedGB} / ${stats.diskTotalGB} GB`
              : "--"}
            percent={stats.diskPercent}
            sub={stats.diskFreeGB != null ? `${stats.diskFreeGB} GB free` : undefined}
          />
          <ResourceCard
            icon={<Monitor className="h-4 w-4" />}
            label="MT5 Terminals"
            value={stats.mt5Processes != null ? String(stats.mt5Processes) : "--"}
            sub={stats.uptimeSeconds != null ? `Up ${formatUptime(stats.uptimeSeconds)}` : undefined}
          />
        </div>
      )}

      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-zinc-100">Accounts</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            if (!open && setupStatus !== "PENDING") resetSetupDialog();
            else setDialogOpen(open);
          }}>
            <DialogTrigger>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="mr-2 h-4 w-4" />
                Add Account
              </Button>
            </DialogTrigger>
            <DialogContent className="border-zinc-700 bg-zinc-900 sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">
                  {setupStatus === "idle" ? "Add Account" : `Setting up account ${accountForm.login}`}
                </DialogTitle>
              </DialogHeader>

              {setupStatus === "idle" ? (
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
                  <div className="space-y-2 relative">
                    <Label className="text-zinc-300">Server (type to search)</Label>
                    <Input
                      value={accountForm.server}
                      onChange={(e) => handleServerSearch(e.target.value)}
                      onFocus={() => { if (serverResults.length > 0) setServerDropdownOpen(true); }}
                      onBlur={() => setTimeout(() => setServerDropdownOpen(false), 200)}
                      required
                      autoComplete="off"
                      className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                      placeholder="Type broker name, e.g. aqua, ftmo..."
                    />
                    {serverDropdownOpen && serverResults.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-[200px] overflow-y-auto rounded-md border border-zinc-600 bg-zinc-800 shadow-lg">
                        {serverResults.map((r) => (
                          <button
                            key={r.server}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-blue-600 hover:text-white border-b border-zinc-700 last:border-b-0 flex items-center justify-between"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectServer(r.server, r.installer_url)}
                          >
                            <span>{r.server}</span>
                            {r.installer_url && (
                              <span className="text-xs text-emerald-400 ml-2">&#10003; installer</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-zinc-300">Installer URL {accountForm.installerUrl ? "" : "(optional)"}</Label>
                    <Input
                      value={accountForm.installerUrl}
                      onChange={(e) => setAccountForm((p) => ({ ...p, installerUrl: e.target.value }))}
                      className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
                      placeholder={accountForm.installerUrl ? "" : "Auto-detected when you select a server"}
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Add Account
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
              ) : (
                <div className="space-y-4">
                  {/* Status indicator */}
                  <div className="flex items-center gap-3">
                    {setupStatus === "PENDING" && (
                      <div className="flex items-center gap-2 text-blue-400">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm font-medium">Setting up account... (2-4 minutes)</span>
                      </div>
                    )}
                    {setupStatus === "SUCCESS" && (
                      <div className="flex items-center gap-2 text-emerald-400">
                        <CheckCircle2 className="h-5 w-5" />
                        <span className="text-sm font-medium">Account setup complete!</span>
                      </div>
                    )}
                    {setupStatus === "FAILED" && (
                      <div className="flex items-center gap-2 text-red-400">
                        <XCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">Account setup failed</span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  {setupStatus === "PENDING" && (
                    <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full w-full rounded-full bg-blue-500 animate-pulse" />
                    </div>
                  )}

                  {/* Steps log */}
                  <div className="max-h-[250px] overflow-auto rounded bg-black p-3 font-mono text-xs leading-5 text-green-400">
                    {setupSteps.map((step, i) => (
                      <div key={i} className={`whitespace-pre-wrap ${
                        step.startsWith("ERROR") || step.startsWith("Failed")
                          ? "text-red-400"
                          : step.startsWith("WARNING")
                            ? "text-yellow-400"
                            : ""
                      }`}>
                        {step}
                      </div>
                    ))}
                    {setupStatus === "PENDING" && (
                      <div className="text-zinc-500 animate-pulse mt-1">Waiting for VPS response...</div>
                    )}
                  </div>

                  {/* Close button when done */}
                  {setupStatus !== "PENDING" && (
                    <div className="flex gap-3 pt-2">
                      <Button
                        onClick={resetSetupDialog}
                        className={setupStatus === "SUCCESS"
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                          : "bg-zinc-700 hover:bg-zinc-600 text-white"
                        }
                      >
                        {setupStatus === "SUCCESS" ? "Done" : "Close"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
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
                vps.accounts.map((account) => {
                  const roles = copierInfo.filter(
                    (c) => c.login === account.login && c.server === account.server
                  );
                  return (
                  <TableRow
                    key={`${account.server}-${account.login}`}
                    className="border-zinc-700 hover:bg-zinc-800/50 cursor-pointer"
                    onClick={() => router.push(`/accounts/${id}/${account.server}/${account.login}`)}
                  >
                    <TableCell className="font-mono text-zinc-200">{account.login}</TableCell>
                    <TableCell className="text-zinc-300">{account.server}</TableCell>
                    <TableCell className="text-zinc-200">{formatCurrency(account.balance)}</TableCell>
                    <TableCell className="text-zinc-200">{formatCurrency(account.equity)}</TableCell>
                    <TableCell className={profitColor(account.profit)}>{formatProfit(account.profit)}</TableCell>
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
                        {roles.map((r) => (
                          <Badge
                            key={r.sessionId + r.role}
                            className={
                              r.role === "source"
                                ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                                : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                            }
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            {r.role === "source" ? "Source" : "Target"}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/accounts/${id}/${account.server}/${account.login}`}>
                        <Button variant="ghost" size="sm" className="text-blue-500 hover:text-blue-400 hover:bg-blue-500/10">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceCard({
  icon,
  label,
  value,
  percent,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  percent?: number | null;
  sub?: string;
}) {
  const barColor =
    percent == null ? "bg-zinc-600"
    : percent >= 90 ? "bg-red-500"
    : percent >= 70 ? "bg-yellow-500"
    : "bg-emerald-500";

  return (
    <Card className="border-zinc-700 bg-zinc-900">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-zinc-400 mb-2">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="text-sm font-medium text-zinc-100">{value}</div>
        {percent != null && (
          <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
        )}
        {sub && <div className="mt-1 text-[11px] text-zinc-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
