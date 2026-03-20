import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "mt5_auth";

export function middleware(request: NextRequest) {
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

  if (!expected || token === expected) {
    return NextResponse.next();
  }

  // Redirect to login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
