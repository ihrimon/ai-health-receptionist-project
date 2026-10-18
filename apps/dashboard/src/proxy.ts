import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildCsp, generateNonce, isWidgetPath } from "@/lib/csp";

// Not the real API session cookie (bs_session) — that one belongs to
// the API's own domain and the browser never sends it to the dashboard's
// domain once they're deployed separately. This is the dashboard's own
// same-domain marker, set client-side right after a successful login
// (see lib/api.ts's markDashboardSession) purely for this redirect UX.
const SESSION_COOKIE = "dash_session";

// Signed-in visitors skip these and go to their dashboard.
const SIGNED_OUT_ONLY = ["/login", "/signup"];

const isDev = process.env.NODE_ENV !== "production";
const apiOrigin = new URL(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
).origin;

function isUnder(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Two jobs. (1) M7-26: give every page a fresh CSP nonce (script-src without
 * 'unsafe-inline'); the fallback widget page /w/* is skipped so it stays
 * frameable. (2) M1-28, UX-only routing: signed-out visitors to /app or
 * /admin go to /login (remembering where they were going), signed-in ones
 * skip the login and signup pages. It only checks that the marker cookie
 * exists (validating the session would need a database lookup in the edge
 * runtime). The real check is SessionProvider's GET /v1/auth/me, which
 * clears a stale marker on 401, and the API's own guards.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);

  if (SIGNED_OUT_ONLY.includes(pathname)) {
    if (signedIn) return NextResponse.redirect(new URL("/app", request.url));
  } else if (
    (isUnder(pathname, "/app") || isUnder(pathname, "/admin")) &&
    !signedIn
  ) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  if (isWidgetPath(pathname)) return NextResponse.next();

  const nonce = generateNonce();
  const csp = buildCsp({ nonce, isDev, apiOrigin });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
