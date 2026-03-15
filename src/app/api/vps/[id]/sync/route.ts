import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vps = await prisma.vps.findUniqueOrThrow({ where: { id } });
    const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });

    // GET /accounts is fast — just reads accounts.txt, no EA calls
    const accounts = await client.getAccounts();

    const upserted = [];
    for (const acct of Object.values(accounts)) {
      const record = await prisma.account.upsert({
        where: {
          vpsId_server_login: {
            vpsId: id,
            server: acct.server,
            login: acct.login,
          },
        },
        create: {
          vpsId: id,
          login: acct.login,
          server: acct.server,
        },
        update: {},
      });
      upserted.push(record);
    }

    // Mark VPS as ONLINE since we successfully reached it
    await prisma.vps.update({
      where: { id },
      data: { status: "ONLINE", lastSeen: new Date(), lastError: null },
    });

    return NextResponse.json({
      synced: upserted.length,
      accounts: upserted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
