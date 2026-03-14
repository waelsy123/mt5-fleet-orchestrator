"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";

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

  useEffect(() => {
    async function fetchVps() {
      try {
        const res = await fetch("/api/vps");
        if (!res.ok) throw new Error("Failed to fetch VPS list");
        const json = await res.json();
        setVpsList(json);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchVps();
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">VPS Fleet</h1>
        <Link href="/vps/new">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="mr-2 h-4 w-4" />
            Add VPS
          </Button>
        </Link>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-900">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-700 hover:bg-transparent">
              <TableHead className="text-zinc-400">Name</TableHead>
              <TableHead className="text-zinc-400">IP</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400">Accounts</TableHead>
              <TableHead className="text-zinc-400">Last Seen</TableHead>
              <TableHead className="text-zinc-400">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vpsList.length === 0 ? (
              <TableRow className="border-zinc-700">
                <TableCell colSpan={6} className="text-center text-zinc-500 py-8">
                  No VPS servers configured. Click &quot;Add VPS&quot; to get started.
                </TableCell>
              </TableRow>
            ) : (
              vpsList.map((vps) => (
                <TableRow key={vps.id} className="border-zinc-700 hover:bg-zinc-800/50">
                  <TableCell className="font-medium text-zinc-200">{vps.name}</TableCell>
                  <TableCell className="text-zinc-300 font-mono text-sm">{vps.ip}</TableCell>
                  <TableCell>{statusBadge(vps.status)}</TableCell>
                  <TableCell className="text-zinc-300">{vps.accountCount}</TableCell>
                  <TableCell className="text-zinc-400 text-sm">
                    {vps.lastSeen ? new Date(vps.lastSeen).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell>
                    <Link href={`/vps/${vps.id}`}>
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
      </div>
    </div>
  );
}
