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
    const { client } = await getClient(vpsId);
    const result = await client.getCopierStatus();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
