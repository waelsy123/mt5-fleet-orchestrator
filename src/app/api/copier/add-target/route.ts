import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { copier } from "@/lib/copier";

export async function POST(request: NextRequest) {
  try {
    const { vpsId, server, login, mode } = await request.json();

    if (!vpsId || !server || !login) {
      return NextResponse.json({ error: "vpsId, server, and login are required" }, { status: 400 });
    }

    // Validate account exists
    await prisma.account.findFirstOrThrow({
      where: { vpsId, server, login },
    });

    // Reject if this account is currently the source
    if (copier.isActiveSource(vpsId, server, login)) {
      return NextResponse.json(
        { error: `${login}@${server} is the copy source — a master cannot also be a slave` },
        { status: 400 }
      );
    }

    const result = await copier.addTarget({ vpsId, server, login, mode: mode ?? "opposite" });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ status: "OK", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
