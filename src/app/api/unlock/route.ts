import { NextResponse } from "next/server";
import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  deriveToken,
  expectedToken,
  tokensMatch,
} from "@/lib/solutions-gate";

/**
 * Exchange the password for a cookie.
 *
 * Deliberately a POST to an endpoint rather than a query parameter: a password
 * in a URL ends up in browser history, in the referrer header, and in every
 * access log between here and the server.
 */
export async function POST(request: Request) {
  const expected = await expectedToken(process.env.DIAGRAMS_PASSWORD);
  if (expected === null) {
    return NextResponse.json(
      { ok: false, error: "No password is configured for this deployment." },
      { status: 503 },
    );
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  if (!tokensMatch(await deriveToken(password), expected)) {
    // One message for every kind of failure. Distinguishing "wrong password"
    // from anything else tells an attacker which half they got right.
    return NextResponse.json({ ok: false, error: "That password is not right." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: expected,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}

/** Sign out, mostly so a shared machine can be cleared. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: COOKIE_NAME, value: "", path: "/", maxAge: 0 });
  return response;
}
