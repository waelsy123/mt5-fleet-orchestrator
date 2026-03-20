import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { copierManager } from "@/lib/copier";

export async function GET() {
  try {
    const [vpsList, recentLogs] = await Promise.all([
      prisma.vps.findMany({
        include: {
          accounts: {
            select: {
              login: true,
              server: true,
              equity: true,
              balance: true,
              profit: true,
              connected: true,
            },
          },
        },
      }),
      prisma.copierLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
    ]);

    const totalVps = vpsList.length;
    const onlineVps = vpsList.filter((v) => v.status === "ONLINE").length;
    let totalAccounts = 0;
    let totalEquity = 0;
    let totalBalance = 0;
    let totalProfit = 0;

    const alerts: { type: string; message: string; vpsId?: string; vpsName?: string; login?: string; server?: string }[] = [];

    const vps = vpsList.map((v) => {
      const accountCount = v.accounts.length;
      const vpsEquity = v.accounts.reduce((sum, a) => sum + a.equity, 0);
      const vpsBalance = v.accounts.reduce((sum, a) => sum + a.balance, 0);
      const vpsProfit = v.accounts.reduce((sum, a) => sum + a.profit, 0);

      totalAccounts += accountCount;
      totalEquity += vpsEquity;
      totalBalance += vpsBalance;
      totalProfit += vpsProfit;

      if (v.status === "OFFLINE" || v.status === "ERROR") {
        alerts.push({
          type: "vps_offline",
          message: `${v.name} (${v.ip}) is ${v.status.toLowerCase()}${v.lastError ? `: ${v.lastError}` : ""}`,
          vpsId: v.id,
          vpsName: v.name,
        });
      }

      for (const a of v.accounts) {
        if (!a.connected && v.status === "ONLINE") {
          alerts.push({
            type: "account_disconnected",
            message: `${a.login}@${a.server} on ${v.name} is disconnected`,
            vpsId: v.id,
            vpsName: v.name,
            login: a.login,
            server: a.server,
          });
        }
      }

      return {
        id: v.id,
        name: v.name,
        ip: v.ip,
        status: v.status,
        accountCount,
        totalEquity: vpsEquity,
        totalProfit: vpsProfit,
      };
    });

    // Copier session summary
    const copierSessions = copierManager.statusAll();
    const activeSessions = copierSessions.filter((s) => s.running).length;
    const activeTrades = copierSessions.reduce(
      (sum, s) => sum + s.targets.reduce((ts, t) => ts + t.synced, 0),
      0
    );
    const failedTrades = copierSessions.reduce(
      (sum, s) => sum + s.targets.reduce((ts, t) => ts + t.failed, 0),
      0
    );

    // Compact copier session info for the dashboard
    const copierInfo = copierSessions
      .filter((s) => s.running)
      .map((s) => ({
        id: s.id,
        source: s.source,
        targetCount: s.targets.length,
        sourcePositions: s.sourcePositions,
        synced: s.summary.synced,
        failed: s.summary.failed,
      }));

    return NextResponse.json({
      totalVps,
      onlineVps,
      totalAccounts,
      totalEquity,
      totalBalance,
      totalProfit,
      activeSessions,
      activeTrades,
      failedTrades,
      copierInfo,
      recentLogs,
      alerts,
      vps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
