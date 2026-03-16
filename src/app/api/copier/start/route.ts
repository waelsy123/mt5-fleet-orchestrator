import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { copier } from "@/lib/copier";
import type { TargetAccount } from "@/lib/copier";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceVpsId, sourceServer, sourceLogin, targets, volumeMult } = body as {
      sourceVpsId: string;
      sourceServer: string;
      sourceLogin: string;
      targets: TargetAccount[];
      volumeMult?: number;
    };

    if (!sourceVpsId || !sourceServer || !sourceLogin) {
      return NextResponse.json({ error: "Source account is required" }, { status: 400 });
    }

    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: "At least one target account is required" }, { status: 400 });
    }

    // Validate source exists
    await prisma.account.findFirstOrThrow({
      where: { vpsId: sourceVpsId, server: sourceServer, login: sourceLogin },
    });

    // Validate targets exist and none is the source
    for (const t of targets) {
      if (t.vpsId === sourceVpsId && t.server === sourceServer && t.login === sourceLogin) {
        return NextResponse.json(
          { error: `Target ${t.login}@${t.server} is the same as source` },
          { status: 400 }
        );
      }
      await prisma.account.findFirstOrThrow({
        where: { vpsId: t.vpsId, server: t.server, login: t.login },
      });
    }

    await copier.start({
      sourceVpsId,
      sourceServer,
      sourceLogin,
      targets,
      volumeMult: volumeMult ?? 1.0,
    });

    return NextResponse.json({ status: "OK", message: `Copier started: 1 source -> ${targets.length} target(s)` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
