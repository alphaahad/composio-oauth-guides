import { describe, expect, it } from "vitest";
import { applyOverrides, type Baseline } from "../research";

const mk = (): Baseline => [
  {
    slug: "a",
    appName: "A",
    generatedAt: "2026-10-31T00:00:00.000Z",
    pagesChecked: [],
    baseline: {
      claims: [
        { claim: "Review takes 1 to 3 weeks.", verdict: "not_addressed", quote: "", url: "" },
        { claim: "Needs a privacy policy.", verdict: "not_addressed", quote: "", url: "" },
        { claim: "Tokens expire.", verdict: "supported", quote: "q", url: "u" },
      ],
      supported: 1,
      partial: 0,
      contradicted: 0,
      notAddressed: 2,
    },
    pipeline: { claims: 5, withQuote: 5, gapsListed: 2 },
  },
];

describe("applyOverrides", () => {
  it("marks matching claims as hand-reviewed and recomputes the counts", () => {
    const out = applyOverrides(mk(), [{ slug: "a", claimStartsWith: "Review takes", verdict: "contradicted", quote: "up to 10 days", url: "https://x.test", note: "n" }]);
    const c = out[0].baseline.claims[0];
    expect(c).toMatchObject({ verdict: "contradicted", handReviewed: true, quote: "up to 10 days", note: "n" });
    expect(out[0].baseline).toMatchObject({ supported: 1, partial: 0, contradicted: 1, notAddressed: 1 });
  });

  it("leaves the machine output untouched when there is no matching override, and does not mutate its input", () => {
    const input = mk();
    const out = applyOverrides(input, [{ slug: "other", claimStartsWith: "Review", verdict: "partial", quote: "q", url: "u", note: "n" }]);
    expect(out[0].baseline.claims.every((c) => !c.handReviewed)).toBe(true);
    expect(input[0].baseline.claims[0].verdict).toBe("not_addressed");
  });
});
