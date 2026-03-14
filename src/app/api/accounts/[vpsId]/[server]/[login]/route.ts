import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";

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
    const { client } = await getClient(vpsId);
    const info = await client.getAccountInfo(server, login);
    return NextResponse.json(info);
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
