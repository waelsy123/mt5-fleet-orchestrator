import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const vpsList = await prisma.vps.findMany({
      include: { _count: { select: { accounts: true } } },
      orderBy: { createdAt: "desc" },
    });
    const result = vpsList.map((v) => ({
      ...v,
      accountCount: v._count.accounts,
      _count: undefined,
    }));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, ip, vncIp, vncPort, password, apiPort } = body;

    const vps = await prisma.vps.create({
      data: {
        name,
        ip,
        vncIp: vncIp ?? null,
        vncPort: vncPort ?? null,
        password,
        apiPort: apiPort ?? 8000,
      },
    });

    return NextResponse.json(vps, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
