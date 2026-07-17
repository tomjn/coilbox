import { describe, expect, it, vi } from "vitest";

// pageLinks.ts pulls in refs.ts (defineCommand) and pages.ts (defineCommand) whose
// published dist won't load under Vitest's node resolver. The classifier is pure, so
// stubbing the leaf lets it load.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { classifyMarkdownLink } from "./pageLinks";

describe("classifyMarkdownLink", () => {
  it("treats http(s)/mailto/tel as external", () => {
    expect(classifyMarkdownLink("https://example.org")).toEqual({
      kind: "external",
      url: "https://example.org",
    });
    expect(classifyMarkdownLink("mailto:a@b.c").kind).toBe("external");
    expect(classifyMarkdownLink("tel:+123").kind).toBe("external");
  });

  it("keeps in-page anchors as anchors", () => {
    expect(classifyMarkdownLink("#section")).toEqual({
      kind: "anchor",
      href: "#section",
    });
  });

  it("resolves @route/ refs to an in-app route", () => {
    expect(classifyMarkdownLink("@route/singleplayer")).toEqual({
      kind: "route",
      to: "/singleplayer",
    });
  });

  it("resolves a plain .md link to its page route via the filename slug", () => {
    expect(classifyMarkdownLink("rules.md")).toEqual({
      kind: "route",
      to: "/pages/rules",
    });
    expect(classifyMarkdownLink("About Us.md")).toEqual({
      kind: "route",
      to: "/pages/about-us",
    });
  });

  it("resolves a @.coilbox/*.md link to its page route too", () => {
    expect(classifyMarkdownLink("@.coilbox/pages/rules.md")).toEqual({
      kind: "route",
      to: "/pages/rules",
    });
  });

  it("treats an app-absolute path as an internal route", () => {
    expect(classifyMarkdownLink("/downloads/games")).toEqual({
      kind: "route",
      to: "/downloads/games",
    });
  });

  it("maps a @.coilbox non-md file link to a coilbox:// asset URL", () => {
    const res = classifyMarkdownLink("@.coilbox/docs/guide.pdf");
    expect(res.kind).toBe("asset");
    if (res.kind === "asset") expect(res.url).toContain("guide.pdf");
  });

  it("renders a @widget/ or malformed ref as inert (not a live link)", () => {
    expect(classifyMarkdownLink("@widget/build-tree").kind).toBe("inert");
    expect(classifyMarkdownLink("@.coilbox/../escape").kind).toBe("inert");
  });

  it("is inert for an empty href", () => {
    expect(classifyMarkdownLink(undefined).kind).toBe("inert");
    expect(classifyMarkdownLink("").kind).toBe("inert");
  });
});
