import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Not the real API session cookie (bs_session) — that one belongs to
// the API's own domain and the browser never sends it to the dashboard's
// domain once they're deployed separately. This is the dashboard's own
// same-domain marker, set client-side right after a successful login
// (see lib/api.ts's markDashboardSession) purely for this redirect UX.
const SESSION_COOKIE = "dash_session";

// Signed-in visitors skip these and go to their dashboard.
const SIGNED_OUT_ONLY = ["/login", "/signup"];

/**
 * M1-28, UX-only routing: signed-out visitors to /app or /admin go to
 * /login (remembering where they were going), signed-in ones skip the
 * login and signup pages. It only checks that the marker cookie exists
 * (validating the session would need a database lookup in the edge
 * runtime). The real check is SessionProvider's GET /v1/auth/me, which
 * clears a stale marker on 401, and the API's own guards.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);

  if (SIGNED_OUT_ONLY.includes(pathname)) {
    return signedIn
      ? NextResponse.redirect(new URL("/app", request.url))
      : NextResponse.next();
  }

  if (!signedIn) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/login", "/signup"],
};
