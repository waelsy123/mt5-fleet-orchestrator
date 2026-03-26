import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";
import { readFileSync } from "fs";
import { join } from "path";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vps = await prisma.vps.findUniqueOrThrow({ where: { id } });
    const eaPath = join(process.cwd(), "python", "PythonBridge.mq5");
    const content = readFileSync(eaPath, "utf-8");
    const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });
    const result = await client.updateEa(content);
    return NextResponse.json({ vpsId: id, vpsName: vps.name, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
