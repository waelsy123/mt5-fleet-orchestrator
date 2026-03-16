import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { copier } from "@/lib/copier";
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

    // Reject if source is currently a slave in the running copier
    if (copier.isActiveTarget(sourceVpsId, sourceServer, sourceLogin)) {
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
      if (copier.isActiveSource(t.vpsId, t.server, t.login)) {
        return NextResponse.json(
          { error: `${t.login}@${t.server} is currently the copy source — a master cannot also be a slave` },
          { status: 400 }
        );
      }
      const targetAccount = await prisma.account.findFirstOrThrow({
        where: { vpsId: t.vpsId, server: t.server, login: t.login },
      });

      // Use explicit volumeMult if provided, otherwise auto-calculate from balance ratio
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

    await copier.start({
      sourceVpsId,
      sourceServer,
      sourceLogin,
      targets: resolvedTargets,
    });

    return NextResponse.json({ status: "OK", message: `Copier started: 1 source -> ${targets.length} target(s)` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
