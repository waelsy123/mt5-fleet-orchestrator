import { NextRequest, NextResponse } from "next/server";
import { copier } from "@/lib/copier";

export async function POST(request: NextRequest) {
  try {
    const { targetKey } = await request.json();
    if (!targetKey) {
      return NextResponse.json({ error: "targetKey is required" }, { status: 400 });
    }
    const result = copier.removeTarget(targetKey);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ status: "OK", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
