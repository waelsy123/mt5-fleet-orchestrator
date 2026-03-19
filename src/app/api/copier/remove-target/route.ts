import { NextRequest, NextResponse } from "next/server";
import { copierManager } from "@/lib/copier";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, targetKey, force } = await request.json();
    if (!sessionId || !targetKey) {
      return NextResponse.json({ error: "sessionId and targetKey are required" }, { status: 400 });
    }
    const session = copierManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 400 });
    }
    const result = session.removeTarget(targetKey, !!force);
    if ("error" in result) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json({ status: "OK", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
