import { NextResponse } from "next/server";
import { copierManager } from "@/lib/copier";

export async function GET() {
  try {
    return NextResponse.json({ sessions: copierManager.statusAll() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
