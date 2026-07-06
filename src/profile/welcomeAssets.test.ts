import { describe, expect, it } from "vitest";
import { rewriteBrandedCss } from "./welcomeAssets";

// rewriteBrandedHtml needs DOMParser (not available under the Node test env), so it
// is exercised in the live smoke test; the pure CSS rewrite is covered here.

describe("rewriteBrandedCss", () => {
  it("rewrites local url() refs to the asset protocol", () => {
    expect(rewriteBrandedCss("body { background: url(images/bg.gif); }")).toBe(
      "body { background: url(coilbox://localhost/portable/images/bg.gif); }",
    );
  });

  it("rewrites @font-face src url() (quotes preserved)", () => {
    expect(rewriteBrandedCss('@font-face { src: url("fonts/x.woff2"); }')).toBe(
      '@font-face { src: url("coilbox://localhost/portable/fonts/x.woff2"); }',
    );
  });

  it("leaves absolute and data url() refs untouched", () => {
    const css =
      "a { background: url(https://x/y.png); } b { background: url(data:image/png;base64,AAAA); }";
    expect(rewriteBrandedCss(css)).toBe(css);
  });
});
