import { NextResponse, type NextRequest } from "next/server";
import { hasStaffSession } from "./lib/session";

// Pages only. API routes handle their own auth.
export function middleware(req: NextRequest) {
  if (!hasStaffSession(req)) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*"] };
