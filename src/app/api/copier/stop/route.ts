import { NextRequest, NextResponse } from "next/server";
import { copierManager } from "@/lib/copier";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, force } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const session = copierManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 400 });
    }

    // Check for active trades — warn user unless force
    if (!force) {
      const activeCount = session.activeTradeCount();
      if (activeCount > 0) {
        return NextResponse.json({
          error: `${activeCount} active copied trade(s) on target accounts.`,
          activeCount,
        }, { status: 409 });
      }
    }

    const result = await copierManager.stopSession(sessionId, !!force);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ status: "OK", message: force ? "Session stopped, closing copied positions" : "Session stopped" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
