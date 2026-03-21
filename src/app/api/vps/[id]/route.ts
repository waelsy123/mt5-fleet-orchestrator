import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { copier } from "@/lib/copier";

function stripPassword<T extends Record<string, unknown>>(obj: T): Omit<T, "password"> {
  const { password: _, ...rest } = obj;
  return rest;
}

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
    return NextResponse.json(stripPassword(vps));
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

    // Whitelist allowed fields to prevent mass assignment
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.ip !== undefined) data.ip = body.ip;
    if (body.vncIp !== undefined) data.vncIp = body.vncIp;
    if (body.vncPort !== undefined) data.vncPort = body.vncPort;
    if (body.apiPort !== undefined) data.apiPort = body.apiPort;
    if (body.password !== undefined) data.password = encrypt(body.password);

    const vps = await prisma.vps.update({
      where: { id },
      data,
    });
    return NextResponse.json(stripPassword(vps));
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
