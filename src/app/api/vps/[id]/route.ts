import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { copier } from "@/lib/copier";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vps = await prisma.vps.findUniqueOrThrow({
      where: { id },
      include: { accounts: true },
    });
    return NextResponse.json(vps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const vps = await prisma.vps.update({
      where: { id },
      data: body,
    });
    return NextResponse.json(vps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if any accounts on this VPS are used in active copier sessions
    const activeSessions = copier.getSessionsForVps(id);
    if (activeSessions.length > 0) {
      const details = activeSessions.map((s) => {
        const role = s.role === "source" ? "master" : "slave";
        return `${s.login}@${s.server} is ${role} in ${s.sessionId}`;
      });
      return NextResponse.json(
        {
          error: "Cannot delete VPS — accounts are used in active copy trading sessions",
          details,
          sessions: [...new Set(activeSessions.map((s) => s.sessionId))],
        },
        { status: 409 }
      );
    }

    await prisma.vps.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
