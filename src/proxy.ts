import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic redirect only: unauthenticated visitors are sent to sign-in before any page renders.
 * This is NOT the security boundary. Every page, server action and route handler re-validates the
 * session and workspace membership on the server (see server/context.ts).
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/onboarding", "/w/:path*"],
};
