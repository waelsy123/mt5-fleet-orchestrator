import { NextRequest, NextResponse } from "next/server";
import { copierManager } from "@/lib/copier";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, targetKey } = await request.json();
    if (!sessionId || !targetKey) {
      return NextResponse.json({ error: "sessionId and targetKey are required" }, { status: 400 });
    }
    const session = copierManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 400 });
    }
    const result = await session.retryTarget(targetKey);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ status: "OK", retried: result.retried });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
