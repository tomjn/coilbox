/**
 * The ids a heading gets, which is what a `#` link on a distribution page points
 * at (issue #1805). The click that uses them is driven through a real render in
 * `../profile/customPageLinks.dom.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import {
  createHeadingScope,
  type HeadingIdPlugin,
  headingSlug,
  remarkHeadingIds,
} from "./markdownAnchors";

/** As much of an mdast tree as these cases build by hand. */
interface Probe {
  type: string;
  value?: string;
  children?: Probe[];
  data?: { hProperties?: { id?: string } };
}

/** A document of headings, each one written as its run of inline pieces. */
function docOf(headings: string[][]): Probe {
  return {
    type: "root",
    children: headings.map((parts) => ({
      type: "heading",
      children: parts.map((value) => ({ type: "text", value })),
    })),
  };
}

/** The id each heading in a document got. */
function idsIn(doc: Probe): (string | undefined)[] {
  return (doc.children ?? []).map((h) => h.data?.hProperties?.id);
}

/** Run the plugin over a tree of headings and report the id each one got. */
function idsFor(...headings: string[][]): (string | undefined)[] {
  const doc = docOf(headings);
  remarkHeadingIds()(doc);
  return idsIn(doc);
}

/**
 * Run one of a scope's passes over its segment's headings, as a render does:
 * on a tree freshly parsed from the same markdown.
 */
function runPass(pass: HeadingIdPlugin, ...headings: string[][]) {
  const doc = docOf(headings);
  pass()(doc);
  return idsIn(doc);
}

describe("the id a heading gets", () => {
  it("is the text, lowercased, with the spaces as dashes", () => {
    // What an author writing `[Installing](#installing-the-game)` expects, and
    // what GitHub would have given the same heading in a README.
    expect(headingSlug("Installing The Game")).toBe("installing-the-game");
  });

  it("drops punctuation and emoji but keeps letters from any alphabet", () => {
    expect(headingSlug("What's new?")).toBe("whats-new");
    expect(headingSlug("Neue Änderungen")).toBe("neue-änderungen");
    expect(headingSlug("Read_me first")).toBe("read_me-first");
  });

  it("numbers a repeated heading, so a link still lands on one of them", () => {
    expect(idsFor(["Setup"], ["Other"], ["Setup"], ["Setup"])).toEqual([
      "setup",
      "other",
      "setup-1",
      "setup-2",
    ]);
  });

  it("leaves a heading of nothing but punctuation without an id", () => {
    // There is no slug to give it, and an empty `id` is not something a link can
    // point at anyway.
    expect(idsFor(["***"])).toEqual([undefined]);
  });

  it("keeps counting across the passes of one page", () => {
    // The page is rendered a segment at a time, so the numbering has to survive
    // the gap between them (issue #1808).
    const page = createHeadingScope();
    expect(runPass(page.pass(), ["Setup"], ["Other"])).toEqual([
      "setup",
      "other",
    ]);
    expect(runPass(page.pass(), ["Setup"])).toEqual(["setup-1"]);
  });

  it("gives a pass the same ids however often it is run", () => {
    // A render is not a promise to render once. React renders twice under
    // StrictMode, and `react-markdown` runs its plugins on each render, so a
    // pass that counted up as it went would rename its own headings.
    const page = createHeadingScope();
    const first = page.pass();
    const second = page.pass();
    expect(runPass(first, ["Setup"])).toEqual(["setup"]);
    expect(runPass(second, ["Setup"])).toEqual(["setup-1"]);
    expect(runPass(first, ["Setup"])).toEqual(["setup"]);
    expect(runPass(second, ["Setup"])).toEqual(["setup-1"]);
  });

  it("counts nothing from another page's scope", () => {
    // Two scopes are two pages, and a heading on one is not a repeat of the
    // same heading on the other.
    expect(runPass(createHeadingScope().pass(), ["Setup"])).toEqual(["setup"]);
    expect(runPass(createHeadingScope().pass(), ["Setup"])).toEqual(["setup"]);
  });

  it("reads the whole heading, formatting and all", () => {
    // A heading is a run of inline nodes rather than one string, so `## The
    // `spring` binary` arrives in three pieces.
    expect(idsFor(["The ", "spring", " binary"])).toEqual([
      "the-spring-binary",
    ]);
  });
});
