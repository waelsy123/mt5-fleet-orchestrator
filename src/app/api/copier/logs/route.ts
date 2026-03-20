import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const sessionId = url.searchParams.get("sessionId") || undefined;
    const targetKey = url.searchParams.get("targetKey") || undefined;
    const action = url.searchParams.get("action") || undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 1000);
    const cursor = url.searchParams.get("cursor") || undefined;

    const where: Record<string, unknown> = {};
    if (sessionId) where.sessionId = sessionId;
    if (targetKey) where.targetKey = targetKey;
    if (action) where.action = action;

    const logs = await prisma.copierLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = logs.length > limit;
    if (hasMore) logs.pop();

    return NextResponse.json({
      logs,
      nextCursor: hasMore ? logs[logs.length - 1].id : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
