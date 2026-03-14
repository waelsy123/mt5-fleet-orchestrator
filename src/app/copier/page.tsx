"use client";

import { useEffect, useState, useRef } from "react";
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
import { Play, Square } from "lucide-react";

interface VpsOption {
  id: string;
  name: string;
}

interface AccountOption {
  login: string;
  server: string;
}

interface CopierStatus {
  running: boolean;
  sourceLogin: string | null;
  sourceServer: string | null;
  targetLogin: string | null;
  targetServer: string | null;
  multiplier: number;
  copiedPositions: number;
  log: string[];
}

export default function CopierPage() {
  const [vpsList, setVpsList] = useState<VpsOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedVps, setSelectedVps] = useState("");
  const [sourceAccount, setSourceAccount] = useState("");
  const [targetAccount, setTargetAccount] = useState("");
  const [multiplier, setMultiplier] = useState("1.0");
  const [status, setStatus] = useState<CopierStatus | null>(null);
  const [loadingVps, setLoadingVps] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function fetchVps() {
      try {
        const res = await fetch("/api/vps");
        if (!res.ok) throw new Error("Failed to fetch VPS list");
        const json = await res.json();
        setVpsList(json.map((v: { id: string; name: string }) => ({ id: v.id, name: v.name })));
      } catch {
        toast.error("Failed to load VPS list");
      } finally {
        setLoadingVps(false);
      }
    }
    fetchVps();
  }, []);

  useEffect(() => {
    if (!selectedVps) {
      setAccounts([]);
      return;
    }
    async function fetchAccounts() {
      setLoadingAccounts(true);
      try {
        const res = await fetch(`/api/vps/${selectedVps}`);
        if (!res.ok) throw new Error("Failed to fetch VPS accounts");
        const json = await res.json();
        setAccounts(
          (json.accounts || []).map((a: { login: string; server: string }) => ({
            login: a.login,
            server: a.server,
          }))
        );
      } catch {
        toast.error("Failed to load accounts");
      } finally {
        setLoadingAccounts(false);
      }
    }
    fetchAccounts();
    fetchStatus();
  }, [selectedVps]);

  async function fetchStatus() {
    if (!selectedVps) return;
    try {
      const res = await fetch(`/api/copier/${selectedVps}/status`);
      if (res.ok) {
        const json = await res.json();
        setStatus(json);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (status?.running && selectedVps) {
      pollRef.current = setInterval(fetchStatus, 2000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.running, selectedVps]);

  async function handleStart() {
    if (!selectedVps || !sourceAccount || !targetAccount) {
      toast.error("Please select VPS, source, and target accounts");
      return;
    }

    const [sourceServer, sourceLogin] = sourceAccount.split("|");
    const [targetServer, targetLogin] = targetAccount.split("|");

    setSubmitting(true);
    try {
      const res = await fetch(`/api/copier/${selectedVps}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLogin,
          sourceServer,
          targetLogin,
          targetServer,
          multiplier: parseFloat(multiplier),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start copier");
      }
      toast.success("Copy trading started");
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to start copier");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop() {
    if (!selectedVps) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/copier/${selectedVps}/stop`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to stop copier");
      toast.success("Copy trading stopped");
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to stop copier");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Copy Trading</h1>

      <Card className="border-zinc-700 bg-zinc-900">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-zinc-100">Configuration</CardTitle>
            {status?.running && (
              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">
                Running
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-zinc-300">VPS</Label>
            {loadingVps ? (
              <p className="text-sm text-zinc-500">Loading VPS list...</p>
            ) : (
              <Select value={selectedVps} onValueChange={(v) => setSelectedVps(v ?? "")}>
                <SelectTrigger className="border-zinc-700 bg-zinc-800 text-zinc-100">
                  <SelectValue placeholder="Select a VPS" />
                </SelectTrigger>
                <SelectContent className="border-zinc-700 bg-zinc-800">
                  {vpsList.map((v) => (
                    <SelectItem
                      key={v.id}
                      value={v.id}
                      className="text-zinc-100 focus:bg-zinc-700 focus:text-zinc-100"
                    >
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedVps && (
            <>
              <div className="space-y-2">
                <Label className="text-zinc-300">Source Account</Label>
                {loadingAccounts ? (
                  <p className="text-sm text-zinc-500">Loading accounts...</p>
                ) : (
                  <Select value={sourceAccount} onValueChange={(v) => setSourceAccount(v ?? "")}>
                    <SelectTrigger className="border-zinc-700 bg-zinc-800 text-zinc-100">
                      <SelectValue placeholder="Select source account" />
                    </SelectTrigger>
                    <SelectContent className="border-zinc-700 bg-zinc-800">
                      {accounts.map((a) => (
                        <SelectItem
                          key={`source-${a.server}-${a.login}`}
                          value={`${a.server}|${a.login}`}
                          className="text-zinc-100 focus:bg-zinc-700 focus:text-zinc-100"
                        >
                          {a.login} @ {a.server}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-300">Target Account</Label>
                {loadingAccounts ? (
                  <p className="text-sm text-zinc-500">Loading accounts...</p>
                ) : (
                  <Select value={targetAccount} onValueChange={(v) => setTargetAccount(v ?? "")}>
                    <SelectTrigger className="border-zinc-700 bg-zinc-800 text-zinc-100">
                      <SelectValue placeholder="Select target account" />
                    </SelectTrigger>
                    <SelectContent className="border-zinc-700 bg-zinc-800">
                      {accounts.map((a) => (
                        <SelectItem
                          key={`target-${a.server}-${a.login}`}
                          value={`${a.server}|${a.login}`}
                          className="text-zinc-100 focus:bg-zinc-700 focus:text-zinc-100"
                        >
                          {a.login} @ {a.server}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
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
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleStart}
                  disabled={submitting || status?.running === true}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {submitting ? "Starting..." : "Start"}
                </Button>
                <Button
                  onClick={handleStop}
                  disabled={submitting || !status?.running}
                  variant="ghost"
                  className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                >
                  <Square className="mr-2 h-4 w-4" />
                  Stop
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {status && (
        <Card className="border-zinc-700 bg-zinc-900">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-zinc-100">Status</CardTitle>
              {status.running && (
                <span className="text-sm text-zinc-400">
                  Copied positions: {status.copiedPositions}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {status.sourceLogin && (
              <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-zinc-500">Source</p>
                  <p className="font-mono text-zinc-200">
                    {status.sourceLogin} @ {status.sourceServer}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">Target</p>
                  <p className="font-mono text-zinc-200">
                    {status.targetLogin} @ {status.targetServer}
                  </p>
                </div>
              </div>
            )}

            <div className="max-h-[400px] overflow-auto rounded bg-black p-4 font-mono text-sm text-green-400">
              {status.log && status.log.length > 0 ? (
                status.log.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap">
                    {line}
                  </div>
                ))
              ) : (
                <p className="text-zinc-600">No log entries yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
