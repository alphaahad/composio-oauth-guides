import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("next config hardening", () => {
  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends security headers on every route and no-store on the API", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!.headers;
    const keys = all.map((h) => h.key);
    for (const k of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy", "Content-Security-Policy", "Strict-Transport-Security", "Cross-Origin-Opener-Policy"]) expect(keys).toContain(k);
    expect(all.find((h) => h.key === "X-Content-Type-Options")!.value).toBe("nosniff");
    expect(all.find((h) => h.key === "Content-Security-Policy")!.value).toContain("frame-ancestors 'none'");
    expect(rules.find((r) => r.source === "/api/:path*")!.headers).toEqual([{ key: "Cache-Control", value: "no-store" }]);
  });
});
