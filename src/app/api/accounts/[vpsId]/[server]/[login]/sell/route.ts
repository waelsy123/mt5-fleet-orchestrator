import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";
import type { TradeRequest } from "@/lib/types";

async function getClient(vpsId: string) {
  const vps = await prisma.vps.findUniqueOrThrow({ where: { id: vpsId } });
  return { client: new VpsClient({ ip: vps.ip, apiPort: vps.apiPort }), vps };
}

export async function POST(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ vpsId: string; server: string; login: string }> }
) {
  try {
    const { vpsId, server, login } = await params;
    const body: TradeRequest = await request.json();
    const { client } = await getClient(vpsId);
    const result = await client.sell(server, login, body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
