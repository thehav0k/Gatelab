import { describe, expect, it } from "vitest";
import { SITE, KEYWORDS, jsonLd } from "./site";

describe("site metadata", () => {
  it("exposes site constants and valid jsonLd schema", () => {
    expect(SITE.name).toBe("Gatelab");
    expect(SITE.url).toContain("https://");
    expect(KEYWORDS.length).toBeGreaterThan(10);

    const ld = jsonLd();
    expect(ld["@type"]).toBe("WebApplication");
    expect(ld.name).toBe(SITE.name);
    expect(ld.featureList.length).toBeGreaterThan(0);
  });
});
