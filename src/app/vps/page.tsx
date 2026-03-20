"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search } from "lucide-react";

interface VpsStats {
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryTotalMB: number | null;
  memoryUsedMB: number | null;
  mt5Processes: number | null;
}

interface Vps {
  id: string;
  name: string;
  ip: string;
  status: "ONLINE" | "OFFLINE" | "PENDING" | "ERROR";
  accountCount: number;
  lastSeen: string | null;
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

export default function VpsListPage() {
  const [vpsList, setVpsList] = useState<Vps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statsMap, setStatsMap] = useState<Record<string, VpsStats>>({});
  const [search, setSearch] = useState("");
  const router = useRouter();

  const filtered = useMemo(() => {
    if (!search.trim()) return vpsList;
    const q = search.toLowerCase();
    return vpsList.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.ip.toLowerCase().includes(q) ||
        v.status.toLowerCase().includes(q)
    );
  }, [vpsList, search]);

  useEffect(() => {
    async function fetchVps() {
      try {
        const res = await fetch("/api/vps");
        if (!res.ok) throw new Error("Failed to fetch VPS list");
        const json: Vps[] = await res.json();
        setVpsList(json);
        setError(null);

        // Fetch stats for each VPS in parallel
        const statsEntries = await Promise.allSettled(
          json.map(async (vps) => {
            const statsRes = await fetch(`/api/vps/${vps.id}/stats`);
            if (!statsRes.ok) return null;
            const s = await statsRes.json();
            return [vps.id, s] as [string, VpsStats];
          })
        );
        const map: Record<string, VpsStats> = {};
        for (const entry of statsEntries) {
          if (entry.status === "fulfilled" && entry.value) {
            const [id, s] = entry.value;
            map[id] = s;
          }
        }
        setStatsMap(map);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchVps();
    const interval = setInterval(fetchVps, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-400">Loading VPS fleet...</p>
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-zinc-100">VPS Fleet</h1>
        <div className="flex items-center gap-3">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Search name, IP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>
        <Link href="/vps/new">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="mr-2 h-4 w-4" />
            Add VPS
          </Button>
        </Link>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-900">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-700 hover:bg-transparent">
              <TableHead className="text-zinc-400">Name</TableHead>
              <TableHead className="text-zinc-400">IP</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400">Accounts</TableHead>
              <TableHead className="text-zinc-400">CPU</TableHead>
              <TableHead className="text-zinc-400">Memory</TableHead>
              <TableHead className="text-zinc-400">MT5</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="border-zinc-700">
                <TableCell colSpan={7} className="text-center text-zinc-500 py-8">
                  {vpsList.length === 0
                    ? "No VPS servers configured. Click \"Add VPS\" to get started."
                    : "No VPS servers match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((vps) => (
                <TableRow
                  key={vps.id}
                  className="border-zinc-700 hover:bg-zinc-800/50 cursor-pointer"
                  onClick={() => router.push(`/vps/${vps.id}`)}
                >
                  <TableCell className="font-medium text-zinc-200">{vps.name}</TableCell>
                  <TableCell className="text-zinc-300 font-mono text-sm">{vps.ip}</TableCell>
                  <TableCell>{statusBadge(vps.status)}</TableCell>
                  <TableCell className="text-zinc-300">{vps.accountCount}</TableCell>
                  <TableCell>
                    <UsageBar value={statsMap[vps.id]?.cpuPercent} />
                  </TableCell>
                  <TableCell>
                    <UsageBar value={statsMap[vps.id]?.memoryPercent} label={
                      statsMap[vps.id]?.memoryUsedMB != null && statsMap[vps.id]?.memoryTotalMB != null
                        ? `${(statsMap[vps.id].memoryUsedMB! / 1024).toFixed(1)}/${(statsMap[vps.id].memoryTotalMB! / 1024).toFixed(1)}G`
                        : undefined
                    } />
                  </TableCell>
                  <TableCell className="text-zinc-300 text-sm">
                    {statsMap[vps.id]?.mt5Processes != null ? statsMap[vps.id].mt5Processes : "--"}
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

function UsageBar({ value, label }: { value?: number | null; label?: string }) {
  if (value == null) return <span className="text-xs text-zinc-600">--</span>;
  const color =
    value >= 90 ? "bg-red-500" : value >= 70 ? "bg-yellow-500" : "bg-emerald-500";
  const textColor =
    value >= 90 ? "text-red-400" : value >= 70 ? "text-yellow-400" : "text-zinc-300";
  return (
    <div className="w-20">
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className={textColor}>{value}%</span>
        {label && <span className="text-zinc-500">{label}</span>}
      </div>
      <div className="h-1 w-full rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}
