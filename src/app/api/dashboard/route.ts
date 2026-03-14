import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const vpsList = await prisma.vps.findMany({
      include: {
        accounts: {
          select: {
            equity: true,
            balance: true,
            profit: true,
          },
        },
      },
    });

    const totalVps = vpsList.length;
    const onlineVps = vpsList.filter((v) => v.status === "ONLINE").length;
    let totalAccounts = 0;
    let totalEquity = 0;
    let totalBalance = 0;
    let totalProfit = 0;

    const vps = vpsList.map((v) => {
      const accountCount = v.accounts.length;
      const vpsEquity = v.accounts.reduce((sum, a) => sum + a.equity, 0);
      const vpsBalance = v.accounts.reduce((sum, a) => sum + a.balance, 0);
      const vpsProfit = v.accounts.reduce((sum, a) => sum + a.profit, 0);

      totalAccounts += accountCount;
      totalEquity += vpsEquity;
      totalBalance += vpsBalance;
      totalProfit += vpsProfit;

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

    return NextResponse.json({
      totalVps,
      onlineVps,
      totalAccounts,
      totalEquity,
      totalBalance,
      totalProfit,
      vps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
