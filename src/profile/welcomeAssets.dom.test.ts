// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

// welcomeAssets.ts pulls in refs.ts (defineCommand) whose published dist won't load
// under Vitest's node resolver. The rewrite is pure, so stub the leaf.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { rewriteBrandedHtml } from "./welcomeAssets";

/**
 * The markup `rewriteBrandedHtml` returns, as an inert fragment. The links in
 * these tests use rel="author" because happy-dom fetches a stylesheet link as
 * soon as it is parsed, and nothing here is serving one.
 */
function bodyOf(html: string): DocumentFragment {
  // A template's content is inert, so a `<link>` in the output is not fetched.
  const holder = document.createElement("template");
  holder.innerHTML = rewriteBrandedHtml(html);
  return holder.content;
}

/**
 * Which elements a distribution's markup may carry (issues #1112 and #1117).
 *
 * A trailing `<base href>` would re-point every relative URL in the whole app
 * once the markup is injected, so it has to go wherever it was written.
 */
describe("the head elements a zone may carry", () => {
  it("moves a leading style and link back into the body, in the order written", () => {
    const body = bodyOf(
      '<link rel="author" href="a.css"><style>b { color: red; }</style><p>hi</p>',
    );
    expect(
      Array.from(body.children).map((el) => el.tagName.toLowerCase()),
    ).toEqual(["link", "style", "p"]);
  });

  it("keeps a trailing style and link", () => {
    const body = bodyOf(
      '<p>hi</p><style>b { color: red; }</style><link rel="author" href="a.css">',
    );
    expect(body.querySelector("style")).not.toBeNull();
    expect(body.querySelector("link")).not.toBeNull();
  });

  it("strips a leading base, meta and script", () => {
    const body = bodyOf(
      '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/"><script>alert(1)</script><p>hi</p>',
    );
    expect(body.querySelector("base, meta, script")).toBeNull();
    expect(body.querySelector("p")?.textContent).toBe("hi");
  });

  it("strips a trailing base, meta and script", () => {
    const body = bodyOf(
      '<p>hi</p><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/"><script>alert(1)</script>',
    );
    expect(body.querySelector("base, meta, script")).toBeNull();
    expect(body.querySelector("p")?.textContent).toBe("hi");
  });

  it("strips them from inside nested markup too", () => {
    const body = bodyOf(
      '<div><section><base href="/x/"><p>hi</p></section></div>',
    );
    expect(body.querySelector("base")).toBeNull();
    expect(body.querySelector("p")?.textContent).toBe("hi");
  });
});
