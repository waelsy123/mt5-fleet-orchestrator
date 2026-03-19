import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vps = await prisma.vps.findUniqueOrThrow({ where: { id } });
    const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });
    const stats = await client.getSystemStats();
    return NextResponse.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
