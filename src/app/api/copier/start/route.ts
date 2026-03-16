import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { copierManager } from "@/lib/copier";
import type { TargetAccount } from "@/lib/copier";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceVpsId, sourceServer, sourceLogin, targets } = body as {
      sourceVpsId: string;
      sourceServer: string;
      sourceLogin: string;
      targets: (TargetAccount & { volumeMult?: number })[];
    };

    if (!sourceVpsId || !sourceServer || !sourceLogin) {
      return NextResponse.json({ error: "Source account is required" }, { status: 400 });
    }

    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: "At least one target account is required" }, { status: 400 });
    }

    // Validate source exists and get balance
    const sourceAccount = await prisma.account.findFirstOrThrow({
      where: { vpsId: sourceVpsId, server: sourceServer, login: sourceLogin },
    });

    // Reject if source is already used in any session (as source or target)
    if (copierManager.isActiveSource(sourceVpsId, sourceServer, sourceLogin)) {
      return NextResponse.json(
        { error: `${sourceLogin}@${sourceServer} is already a source in another session` },
        { status: 400 }
      );
    }
    if (copierManager.isActiveTarget(sourceVpsId, sourceServer, sourceLogin)) {
      return NextResponse.json(
        { error: `${sourceLogin}@${sourceServer} is currently a copy target — a slave cannot also be a master` },
        { status: 400 }
      );
    }

    // Validate targets and auto-calculate volumeMult from balance ratios
    const resolvedTargets: TargetAccount[] = [];
    for (const t of targets) {
      if (t.vpsId === sourceVpsId && t.server === sourceServer && t.login === sourceLogin) {
        return NextResponse.json(
          { error: `Target ${t.login}@${t.server} is the same as source` },
          { status: 400 }
        );
      }
      if (copierManager.isInAnySession(t.vpsId, t.server, t.login)) {
        return NextResponse.json(
          { error: `${t.login}@${t.server} is already in another copier session` },
          { status: 400 }
        );
      }
      const targetAccount = await prisma.account.findFirstOrThrow({
        where: { vpsId: t.vpsId, server: t.server, login: t.login },
      });

      const volumeMult = t.volumeMult ??
        (sourceAccount.balance > 0 ? Math.round((targetAccount.balance / sourceAccount.balance) * 100) / 100 : 1.0);

      resolvedTargets.push({
        vpsId: t.vpsId,
        server: t.server,
        login: t.login,
        mode: t.mode,
        volumeMult,
      });
    }

    const result = await copierManager.startSession({
      sourceVpsId,
      sourceServer,
      sourceLogin,
      targets: resolvedTargets,
    });

    return NextResponse.json({ status: "OK", sessionId: result.sessionId, message: `Session started: 1 source -> ${resolvedTargets.length} target(s)` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
