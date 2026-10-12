import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Not the real API session cookie (bs_session) — that one belongs to
// the API's own domain and the browser never sends it to the dashboard's
// domain once they're deployed separately. This is the dashboard's own
// same-domain marker, set client-side right after a successful login
// (see lib/api.ts's markDashboardSession) purely for this redirect UX.
const SESSION_COOKIE = "dash_session";

/**
 * UX-only gate — redirects to /admin/login when the session cookie is
 * simply absent. It does not check that the session is valid (that would
 * need a database lookup in the edge runtime); the
 * real security boundary is the API's session guard, which every
 * /admin/* page's data actually goes through.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
