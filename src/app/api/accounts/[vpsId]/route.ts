import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";

async function getClient(vpsId: string) {
  const vps = await prisma.vps.findUniqueOrThrow({ where: { id: vpsId } });
  return { client: new VpsClient({ ip: vps.ip, apiPort: vps.apiPort }), vps };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ vpsId: string }> }
) {
  try {
    const { vpsId } = await params;
    const accounts = await prisma.account.findMany({
      where: { vpsId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(accounts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vpsId: string }> }
) {
  try {
    const { vpsId } = await params;
    const body = await request.json();
    const { login, password, server, broker, installer_url, installer_path } =
      body;

    const { client } = await getClient(vpsId);
    const result = await client.addAccount({
      login,
      password,
      server,
      broker,
      installer_url,
      installer_path,
    });

    await prisma.account.upsert({
      where: { vpsId_server_login: { vpsId, server, login } },
      create: {
        vpsId,
        login,
        server,
        broker: broker ?? null,
      },
      update: {
        broker: broker ?? undefined,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
