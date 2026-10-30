import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchToolkits, parseManagedAuth } from "../composio";

const md = readFileSync(join(__dirname, "fixtures/managed-auth.md"), "utf8");
const toolkits = parseManagedAuth(md);

describe("composio managed-auth parser (real page, fetched 2026-10-30)", () => {
  it("matches the counts the page itself states", () => {
    expect(toolkits.filter((t) => t.managed)).toHaveLength(125);
    expect(toolkits.filter((t) => !t.managed)).toHaveLength(262);
  });
  it("classifies known apps", () => {
    expect(matchToolkits("GitHub", toolkits)[0]?.managed).toBe(true);
    expect(matchToolkits("slack", toolkits)[0]?.managed).toBe(true);
    expect(matchToolkits("Shopify", toolkits).some((t) => t.managed)).toBe(false);
    expect(matchToolkits("shopify", toolkits).length).toBeGreaterThan(0);
  });
  it("matches families by prefix and ignores unknown/too-short names", () => {
    expect(matchToolkits("google", toolkits).length).toBeGreaterThan(3);
    expect(matchToolkits("zz", toolkits)).toEqual([]);
    expect(matchToolkits("definitely-not-an-app", toolkits)).toEqual([]);
  });
});

describe("aliases", () => {
  it("maps X to the Twitter toolkit (bring-your-own on the catalog)", () => {
    const m = matchToolkits("X", toolkits);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((t) => /twitter|^x/i.test(t.name + t.slug))).toBe(true);
    expect(m.some((t) => t.managed)).toBe(false);
  });
});
