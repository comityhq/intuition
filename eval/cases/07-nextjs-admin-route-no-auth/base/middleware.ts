import { NextResponse, type NextRequest } from "next/server";

// Redirect signed-out visitors away from the admin pages.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("crew_session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
