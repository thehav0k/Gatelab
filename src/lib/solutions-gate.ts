/**
 * The gate on the worked-solutions catalogue.
 *
 * WHAT THIS IS AND IS NOT. It is a shared-password curtain: one secret, held in
 * an environment variable, that keeps a set of answers off the open web and out
 * of search results. It is not a user system, it has no accounts, and anybody
 * who knows the password can pass it on. That is the right shape for the job —
 * the content is coursework answers, not anybody's data.
 *
 * The cookie holds a DERIVED token rather than the password, so the secret is
 * never sitting in a browser jar waiting to be read out. The derivation is a
 * salted SHA-256, and both the route that issues the cookie and the middleware
 * that checks it call this same function — which is the only way the two can be
 * guaranteed to agree.
 *
 * FAIL CLOSED. With no password configured, `expectedToken` returns null and the
 * middleware locks the route. The alternative — treating "unset" as "open" —
 * means one missing environment variable in production silently publishes
 * everything, and nothing would ever tell you.
 */

export const COOKIE_NAME = "gatelab_solutions";

/** Bumping this invalidates every issued cookie. */
const SALT = "gatelab-solutions-v1";

/** How long a successful unlock lasts. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function deriveToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${SALT}:${password}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/** The token a valid cookie must carry, or null when no password is configured. */
export async function expectedToken(password: string | undefined): Promise<string | null> {
  if (!password || password.length === 0) return null;
  return deriveToken(password);
}

/**
 * Constant-time-ish comparison.
 *
 * Both sides are fixed-length hex digests, so the length check leaks nothing,
 * and the loop deliberately does not exit early. The timing channel here is
 * largely theoretical over a network — but a comparison that returns on the
 * first wrong character is the kind of thing that gets copied into somewhere it
 * matters.
 */
export function tokensMatch(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
