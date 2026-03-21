import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { startProvisioning } from "@/lib/provisioner";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vps = await prisma.vps.findUniqueOrThrow({ where: { id } });

    const logId = await startProvisioning(
      vps.id,
      vps.ip,
      vps.vncIp ?? vps.ip,
      vps.vncPort ?? 5900,
      decrypt(vps.password)
    );

    return NextResponse.json({ logId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
