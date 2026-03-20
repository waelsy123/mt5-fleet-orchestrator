import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startAccountSetup } from "@/lib/account-setup";

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

    const vps = await prisma.vps.findUniqueOrThrow({ where: { id: vpsId } });

    const jobId = await startAccountSetup(vps.id, vps.ip, vps.apiPort, {
      login,
      password,
      server,
      broker,
      installer_url,
      installer_path,
    });

    return NextResponse.json({ jobId, message: "Account setup started" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
