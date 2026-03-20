import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ vpsId: string; server: string; login: string }> }
) {
  try {
    const { vpsId, server, login } = await params;

    const account = await prisma.account.findUnique({
      where: { vpsId_server_login: { vpsId, server, login } },
      select: { id: true },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Default to last 24h, max 7 days
    const hoursParam = request.nextUrl.searchParams.get("hours");
    const hours = Math.min(Math.max(parseInt(hoursParam || "24", 10) || 24, 1), 168);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const snapshots = await prisma.accountSnapshot.findMany({
      where: {
        accountId: account.id,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: "asc" },
      select: {
        balance: true,
        equity: true,
        profit: true,
        positions: true,
        timestamp: true,
      },
    });

    return NextResponse.json(snapshots);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
