import { NextResponse } from "next/server";
import { copier } from "@/lib/copier";

export async function GET() {
  try {
    return NextResponse.json(copier.status());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
