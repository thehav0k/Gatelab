import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CONTACT,
  feedbackPayload,
  isValid,
  mailtoUrl,
  validateFeedback,
  type Feedback,
} from "./feedback";

const fb = (over: Partial<Feedback> = {}): Feedback => ({
  kind: "Bug",
  from: "",
  message: "The K-map wraps the wrong way on row 3.",
  ...over,
});

describe("validateFeedback", () => {
  it("accepts a message with no address at all", () => {
    // An anonymous bug report is still a bug report.
    expect(validateFeedback(fb())).toEqual({});
    expect(isValid(fb())).toBe(true);
  });

  it("rejects an empty message", () => {
    expect(validateFeedback(fb({ message: "   " })).message).toBeDefined();
  });

  it("rejects a message too short to act on", () => {
    expect(validateFeedback(fb({ message: "broken" })).message).toBeDefined();
  });

  it("rejects a message over 5000 characters", () => {
    expect(validateFeedback(fb({ message: "x".repeat(5001) })).message).toBeDefined();
  });

  it("rejects a malformed address but not a missing one", () => {
    // A typo'd address is worse than a blank one: it looks like a reply is coming.
    expect(validateFeedback(fb({ from: "asif@" })).from).toBeDefined();
    expect(validateFeedback(fb({ from: "asif.example.com" })).from).toBeDefined();
    expect(validateFeedback(fb({ from: "asif@example.com" })).from).toBeUndefined();
    expect(validateFeedback(fb({ from: "" })).from).toBeUndefined();
  });
});

describe("feedbackPayload", () => {
  it("carries the message, the kind and the page", () => {
    const p = feedbackPayload(fb({ from: "a@b.co" }), "/lab");
    expect(p.email).toBe("a@b.co");
    expect(p.kind).toBe("Bug");
    expect(p.page).toBe("/lab");
    expect(p.message).toBe("The K-map wraps the wrong way on row 3.");
    expect(p._subject).toContain("Bug");
  });

  it("uses an unroutable address when none is given, rather than a plausible one", () => {
    // Replying to an anonymous report should fail loudly, not vanish.
    expect(feedbackPayload(fb(), "/").email).toBe("anonymous@gatelab.invalid");
  });

  it("ships the honeypot empty", () => {
    expect(feedbackPayload(fb(), "/")._honey).toBe("");
  });

  it("trims the message", () => {
    expect(feedbackPayload(fb({ message: "  hello there  " }), "/").message).toBe(
      "hello there",
    );
  });
});

describe("mailtoUrl", () => {
  it("addresses the maintainer and encodes the body", () => {
    const url = mailtoUrl(fb({ message: "a & b = c" }), "/theory");
    expect(url.startsWith(`mailto:${CONTACT.email}?`)).toBe(true);
    expect(url).toContain("subject=Gatelab");
    // Raw & in the body would truncate the query string at the next param.
    expect(url).not.toContain("a & b");
    expect(decodeURIComponent(url)).toContain("a & b = c");
    expect(decodeURIComponent(url)).toContain("sent from: /theory");
  });

  it("includes a reply address only when one was given", () => {
    expect(decodeURIComponent(mailtoUrl(fb(), "/"))).not.toContain("reply to:");
    expect(decodeURIComponent(mailtoUrl(fb({ from: "a@b.co" }), "/"))).toContain(
      "reply to: a@b.co",
    );
  });

  it("survives any message without producing a broken URL", () => {
    fc.assert(
      fc.property(fc.string(), fc.webPath(), (message, page) => {
        const url = mailtoUrl(fb({ message }), page);
        // If this parses, a mail client can open it.
        expect(() => new URL(url)).not.toThrow();
      }),
    );
  });
});
