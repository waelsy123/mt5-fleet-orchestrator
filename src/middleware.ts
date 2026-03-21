import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "mt5_auth";

async function deriveToken(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret + ":mt5_session");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public pages: login, docs, health
  if (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/health" ||
    pathname === "/docs" ||
    pathname === "/api/docs"
  ) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const expected = process.env.AUTH_SECRET;

  // Fail closed: reject all requests if AUTH_SECRET is not configured
  if (!expected) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Compare against derived token, not raw secret
  const expectedToken = await deriveToken(expected);
  if (token === expectedToken) {
    return NextResponse.next();
  }

  // Redirect to login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
