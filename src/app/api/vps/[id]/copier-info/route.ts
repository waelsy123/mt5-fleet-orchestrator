import { NextRequest, NextResponse } from "next/server";
import { copierManager } from "@/lib/copier";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessions = copierManager.getSessionsForVps(id);
    return NextResponse.json(sessions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
