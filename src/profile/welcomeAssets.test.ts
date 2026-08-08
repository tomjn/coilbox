import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// welcomeAssets.ts pulls in refs.ts (defineCommand) whose published dist won't load
// under Vitest's node resolver. The rewrite is pure, so stub the leaf.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { classifyMarkdownLink } from "./pageLinks";
import { rewriteBrandedCss, rewrittenUrl } from "./welcomeAssets";

// rewriteBrandedHtml needs DOMParser (not available under the Node test env), so it
// is exercised in the live smoke test. Its per-attribute decision is `rewrittenUrl`,
// which is pure and covered here along with the CSS rewrite that shares it.

/**
 * Which elements a distribution's markup may carry, asserted on the source
 * because the DOM work it takes to enforce cannot run here (issue #1117).
 *
 * Two one-line statements decide the whole policy, and either could be dropped
 * without a single unit test noticing. Losing the first puts back the split
 * where a `<style>` or a `<link>` worked or did not depending on which line the
 * author wrote it on. Losing the second puts back a markup block that can
 * re-point every relative URL in Coilbox with a trailing `<base href>`.
 */
describe("the head elements a zone may carry", () => {
  const source = readFileSync(
    new URL("./welcomeAssets.ts", import.meta.url),
    "utf8",
  );

  it("moves a leading style and link back into the body", () => {
    expect(source).toContain('doc.head.querySelectorAll("style, link")');
  });

  it("strips the app-scoped elements wherever they were written", () => {
    expect(source).toContain('doc.body.querySelectorAll("base, meta, script")');
  });
});

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

  it("resolves a @.coilbox url() to the file it names", () => {
    expect(
      rewriteBrandedCss("body { background: url(@.coilbox/images/bg.gif); }"),
    ).toBe(
      "body { background: url(coilbox://localhost/portable/images/bg.gif); }",
    );
  });
});

describe("rewrittenUrl", () => {
  it("rewrites a relative path to the asset protocol", () => {
    expect(rewrittenUrl("images/logo.webp")).toBe(
      "coilbox://localhost/portable/images/logo.webp",
    );
  });

  it("rewrites a @.coilbox file ref to the path it names", () => {
    expect(rewrittenUrl("@.coilbox/images/logo.webp")).toBe(
      "coilbox://localhost/portable/images/logo.webp",
    );
  });

  it("leaves a @route/ or @widget/ ref for the app to read", () => {
    expect(rewrittenUrl("@route/play/replays")).toBeUndefined();
    expect(rewrittenUrl(" @route/singleplayer ")).toBeUndefined();
    expect(rewrittenUrl("@widget/build-tree")).toBeUndefined();
  });

  it("leaves an @ value that is not a reference alone", () => {
    // Neither a path nor a ref, so an asset URL built from it could only 404.
    expect(rewrittenUrl("@")).toBeUndefined();
    expect(rewrittenUrl("@nosuch/thing")).toBeUndefined();
    expect(rewrittenUrl("@.coilbox/../secret")).toBeUndefined();
  });

  it("leaves absolute, in-page and app-absolute URLs alone", () => {
    expect(rewrittenUrl("https://example.org/x.png")).toBeUndefined();
    expect(rewrittenUrl("data:image/png;base64,AAAA")).toBeUndefined();
    expect(rewrittenUrl("#/play/skirmish")).toBeUndefined();
    expect(rewrittenUrl("/downloads/games")).toBeUndefined();
  });
});

/**
 * The `href` half of a navigate marker: what the click handler reads is whatever
 * the rewrite left on the element, so classify that rather than the source value
 * (issue #1048). Every `href` form the distribution docs promise, end to end apart
 * from the DOM parse.
 */
describe("the href a navigate marker resolves through", () => {
  const asClicked = (href: string) =>
    classifyMarkdownLink(rewrittenUrl(href) ?? href);

  it("resolves a @route/ href to that route", () => {
    expect(asClicked("@route/play/replays")).toEqual({
      kind: "route",
      to: "/play/replays",
    });
  });

  it("resolves an app-absolute href to that route", () => {
    expect(asClicked("/downloads/games")).toEqual({
      kind: "route",
      to: "/downloads/games",
    });
  });

  it("resolves a .md href to its page route", () => {
    expect(asClicked("rules.md")).toEqual({
      kind: "route",
      to: "/pages/rules",
    });
    expect(asClicked("@.coilbox/rules.md")).toEqual({
      kind: "route",
      to: "/pages/rules",
    });
  });

  it("leaves a hash link to the browser", () => {
    // Not a route target, so the handler skips preventDefault and the hash
    // navigates the app itself.
    expect(asClicked("#/play/skirmish").kind).toBe("anchor");
  });
});
