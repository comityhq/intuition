import { NextResponse, type NextRequest } from "next/server";
import { hasStaffSession } from "./lib/session";

export function middleware(req: NextRequest) {
  if (!hasStaffSession(req)) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/api/internal/:path*"] };
