import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, expectedToken, tokensMatch } from "@/lib/solutions-gate";

/**
 * Guards the worked-solutions catalogue.
 *
 * The check happens HERE rather than inside the page, because a page-level check
 * in this app would run in the browser: every route is statically prerendered,
 * so the HTML — answers and all — would already have been sent before any
 * JavaScript could decide the visitor was not allowed to see it. Middleware runs
 * before the response exists, which is the only place a gate can actually gate.
 */
export const config = {
  matcher: ["/solutions/:path*", "/solutions"],
};

export async function middleware(request: NextRequest) {
  const expected = await expectedToken(process.env.DIAGRAMS_PASSWORD);
  const presented = request.cookies.get(COOKIE_NAME)?.value;
  if (tokensMatch(presented, expected)) return NextResponse.next();

  const unlock = new URL("/unlock", request.url);
  unlock.searchParams.set("next", request.nextUrl.pathname);
  if (expected === null) unlock.searchParams.set("unset", "1");
  return NextResponse.redirect(unlock);
}
