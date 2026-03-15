import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";

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

    const port = apiPort ?? 8000;
    const vps = await prisma.vps.create({
      data: {
        name,
        ip,
        vncIp: vncIp ?? null,
        vncPort: vncPort ?? null,
        password,
        apiPort: port,
      },
    });

    // Try to sync accounts if VPS API is already running
    try {
      const client = new VpsClient({ ip, apiPort: port });
      const accounts = await client.getAccounts();
      const entries = Object.values(accounts);

      if (entries.length > 0) {
        for (const acct of entries) {
          await prisma.account.upsert({
            where: {
              vpsId_server_login: {
                vpsId: vps.id,
                server: acct.server,
                login: acct.login,
              },
            },
            create: {
              vpsId: vps.id,
              login: acct.login,
              server: acct.server,
            },
            update: {},
          });
        }

        await prisma.vps.update({
          where: { id: vps.id },
          data: { status: "ONLINE", lastSeen: new Date(), lastError: null },
        });

        const updated = await prisma.vps.findUniqueOrThrow({
          where: { id: vps.id },
          include: { accounts: true },
        });
        return NextResponse.json(updated, { status: 201 });
      }
    } catch {
      // VPS API not reachable yet — that's fine, stays PENDING
    }

    return NextResponse.json(vps, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
