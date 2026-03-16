import { NextResponse } from "next/server";
import { copier } from "@/lib/copier";

export async function POST() {
  try {
    copier.stop();
    return NextResponse.json({ status: "OK", message: "Copier stopped" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
