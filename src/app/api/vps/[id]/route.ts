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
    copier.onVpsDeleted(id);
    await prisma.vps.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
