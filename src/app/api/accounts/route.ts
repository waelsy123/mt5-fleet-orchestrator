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
    const result = accounts.map((a) => ({
      ...a,
      vpsName: a.vps.name,
      vps: undefined,
    }));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
