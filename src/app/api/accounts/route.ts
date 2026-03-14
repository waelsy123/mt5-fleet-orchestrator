import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      include: {
        vps: { select: { name: true, ip: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(accounts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
