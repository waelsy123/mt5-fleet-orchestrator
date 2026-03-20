"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Wifi,
  Users,
  DollarSign,
  TrendingUp,
  Copy,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { formatCurrency, formatProfit, profitColor } from "@/lib/format";

interface VpsSummary {
  id: string;
  name: string;
  ip: string;
  status: "ONLINE" | "OFFLINE" | "PENDING" | "ERROR";
  accountCount: number;
  totalEquity: number;
  totalProfit: number;
}

interface Alert {
  type: string;
  message: string;
  vpsId?: string;
  vpsName?: string;
}

interface DashboardData {
  totalVps: number;
  onlineVps: number;
  totalAccounts: number;
  totalEquity: number;
  totalProfit: number;
  activeSessions: number;
  activeTrades: number;
  alerts: Alert[];
  vps: VpsSummary[];
}

function statusBadge(status: string) {
  switch (status) {
    case "ONLINE":
      return <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">ONLINE</Badge>;
    case "OFFLINE":
      return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">OFFLINE</Badge>;
    case "ERROR":
      return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">ERROR</Badge>;
    case "PENDING":
      return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">PENDING</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) throw new Error("Failed to fetch dashboard");
        const json = await res.json();
        setData(json);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
    const interval = setInterval(fetchDashboard, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-zinc-400">Loading dashboard...</p>
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

  if (!data) return null;

  const stats = [
    { label: "Total VPS", value: data.totalVps, icon: Server, color: "text-blue-500" },
    { label: "Online VPS", value: data.onlineVps, icon: Wifi, color: "text-emerald-500" },
    { label: "Total Accounts", value: data.totalAccounts, icon: Users, color: "text-blue-500" },
    { label: "Total Equity", value: formatCurrency(data.totalEquity), icon: DollarSign, color: "text-emerald-500" },
    { label: "Total P&L", value: formatProfit(data.totalProfit), icon: TrendingUp, color: data.totalProfit >= 0 ? "text-emerald-500" : "text-red-500", valueColor: profitColor(data.totalProfit) },
    { label: "Copier Sessions", value: data.activeSessions > 0 ? `${data.activeSessions} active (${data.activeTrades} trades)` : "None", icon: Copy, color: data.activeSessions > 0 ? "text-blue-500" : "text-zinc-500" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-zinc-700 bg-zinc-900">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">
                {stat.label}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${"valueColor" in stat && stat.valueColor ? stat.valueColor : "text-zinc-100"}`}>
                {stat.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.alerts.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-zinc-100">Alerts</h2>
          <div className="space-y-2">
            {data.alerts.map((alert, i) => (
              <Link
                key={i}
                href={alert.vpsId ? `/vps/${alert.vpsId}` : "#"}
              >
                <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-zinc-800/80 cursor-pointer ${
                  alert.type === "vps_offline"
                    ? "border-red-500/30 bg-red-500/10"
                    : "border-yellow-500/30 bg-yellow-500/10"
                }`}>
                  {alert.type === "vps_offline" ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                  )}
                  <span className={`text-sm ${
                    alert.type === "vps_offline" ? "text-red-300" : "text-yellow-300"
                  }`}>
                    {alert.message}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="text-lg font-semibold text-zinc-100">VPS Fleet</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.vps.map((vps) => (
          <Link key={vps.id} href={`/vps/${vps.id}`}>
            <Card className="border-zinc-700 bg-zinc-900 transition-colors hover:border-zinc-600 hover:bg-zinc-800/80 cursor-pointer">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold text-zinc-100">
                    {vps.name}
                  </CardTitle>
                  {statusBadge(vps.status)}
                </div>
                <p className="text-sm text-zinc-400">{vps.ip}</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-zinc-500">Accounts</p>
                    <p className="font-medium text-zinc-200">{vps.accountCount}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Equity</p>
                    <p className="font-medium text-zinc-200">{formatCurrency(vps.totalEquity)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Profit</p>
                    <p className={`font-medium ${profitColor(vps.totalProfit)}`}>
                      {formatProfit(vps.totalProfit)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
