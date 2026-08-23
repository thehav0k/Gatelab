import { describe, expect, it } from "vitest";
import {
  COOKIE_NAME,
  deriveToken,
  expectedToken,
  tokensMatch,
} from "./solutions-gate";

describe("the solutions gate", () => {
  it("derives a stable token that is not the password", async () => {
    const token = await deriveToken("hunter2");
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(token).not.toContain("hunter2");
    expect(await deriveToken("hunter2")).toBe(token);
  });

  it("gives different passwords different tokens", async () => {
    expect(await deriveToken("a")).not.toBe(await deriveToken("b"));
    // Including the ones that differ only in a trailing character, which a weak
    // derivation would collide.
    expect(await deriveToken("secret")).not.toBe(await deriveToken("secret "));
  });

  /**
   * FAIL CLOSED. This is the assertion that matters most in the file: with no
   * password configured, there must be no token that opens the route. Treating
   * "unset" as "open" would mean one missing environment variable silently
   * publishes the whole catalogue, with nothing anywhere to say so.
   */
  it("has no valid token at all when no password is configured", async () => {
    expect(await expectedToken(undefined)).toBeNull();
    expect(await expectedToken("")).toBeNull();

    for (const attempt of ["", "anything", await deriveToken("")]) {
      expect(tokensMatch(attempt, await expectedToken(undefined))).toBe(false);
    }
  });

  it("accepts only the exact token", async () => {
    const expected = await expectedToken("open sesame");
    expect(tokensMatch(await deriveToken("open sesame"), expected)).toBe(true);
    expect(tokensMatch(await deriveToken("Open Sesame"), expected)).toBe(false);
    expect(tokensMatch(undefined, expected)).toBe(false);
    expect(tokensMatch("", expected)).toBe(false);
    // A truncated token must not pass by being a prefix.
    expect(tokensMatch((expected as string).slice(0, 32), expected)).toBe(false);
  });

  it("names the cookie once, so the issuer and the checker cannot disagree", () => {
    expect(COOKIE_NAME).toBe("gatelab_solutions");
  });
});
