import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { copierManager } from "@/lib/copier";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, vpsId, server, login, mode, volumeMult: explicitMult } = await request.json();

    if (!sessionId || !vpsId || !server || !login) {
      return NextResponse.json({ error: "sessionId, vpsId, server, and login are required" }, { status: 400 });
    }

    const session = copierManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 400 });
    }

    // Reject if account is already in any session
    if (copierManager.isInAnySession(vpsId, server, login)) {
      return NextResponse.json(
        { error: `${login}@${server} is already in a copier session` },
        { status: 400 }
      );
    }

    const targetAccount = await prisma.account.findFirstOrThrow({
      where: { vpsId, server, login },
    });

    // Auto-calculate volumeMult from balance ratio if not explicitly provided
    let volumeMult = explicitMult ?? 1.0;
    const sourceInfo = session.getSourceInfo();
    if (sourceInfo && !explicitMult) {
      const sourceAccount = await prisma.account.findFirst({
        where: { vpsId: sourceInfo.vpsId, server: sourceInfo.server, login: sourceInfo.login },
      });
      if (sourceAccount && sourceAccount.balance > 0) {
        volumeMult = Math.round((targetAccount.balance / sourceAccount.balance) * 100) / 100;
      }
    }

    const result = await session.addTarget({ vpsId, server, login, mode: mode ?? "opposite", volumeMult });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ status: "OK", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
