import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";
import { copier } from "@/lib/copier";

async function getClient(vpsId: string) {
  const vps = await prisma.vps.findUniqueOrThrow({ where: { id: vpsId } });
  return { client: new VpsClient({ ip: vps.ip, apiPort: vps.apiPort }), vps };
}

export async function GET(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ vpsId: string; server: string; login: string }> }
) {
  try {
    const { vpsId, server, login } = await params;
    const { client, vps } = await getClient(vpsId);
    const info = await client.getAccountInfo(server, login);
    return NextResponse.json({
      login: info.login,
      server: info.server,
      balance: info.balance,
      equity: info.equity,
      profit: info.equity - info.balance,
      freeMargin: info.free_margin,
      leverage: info.leverage,
      connected: info.status === "OK",
      vpsName: vps.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ vpsId: string; server: string; login: string }> }
) {
  try {
    const { vpsId, server, login } = await params;

    // Check if this account is used in active copier sessions
    const activeSessions = copier.getSessionsForAccount(vpsId, server, login);
    if (activeSessions.length > 0) {
      const details = activeSessions.map((s) => {
        const role = s.role === "source" ? "master" : "slave";
        return `${login}@${server} is ${role} in ${s.sessionId}`;
      });
      return NextResponse.json(
        {
          error: `Cannot delete account — ${login}@${server} is used in active copy trading`,
          details,
          sessions: activeSessions.map((s) => s.sessionId),
        },
        { status: 409 }
      );
    }

    const { client } = await getClient(vpsId);
    const result = await client.removeAccount(login);

    await prisma.account.delete({
      where: { vpsId_server_login: { vpsId, server, login } },
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
