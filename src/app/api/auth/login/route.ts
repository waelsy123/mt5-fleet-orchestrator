import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

function deriveToken(secret: string): string {
  return createHash("sha256")
    .update(secret + ":mt5_session")
    .digest("hex");
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    return NextResponse.json({ error: "AUTH_SECRET not configured" }, { status: 500 });
  }

  if (password !== secret) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  // Store a derived token in the cookie, never the raw secret
  const token = deriveToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("mt5_auth", token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });
  return res;
}
