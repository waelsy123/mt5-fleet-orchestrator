import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const log = await prisma.provisionLog.findFirst({
      where: { vpsId: id },
      orderBy: { startedAt: "desc" },
    });

    if (!log) {
      return NextResponse.json({ status: "none" });
    }

    return NextResponse.json({
      status: log.status,
      logs: log.logs,
      startedAt: log.startedAt,
      finishedAt: log.finishedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
