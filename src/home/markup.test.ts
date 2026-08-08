import { afterEach, describe, expect, it, vi } from "vitest";

// markup.ts reaches `profile_file` through refs.ts, which imports defineCommand
// from @picoframe/plugin-sdk, whose published dist will not load under Vitest's
// node resolver. Every test here injects its own reader, so stubbing the leaf
// only lets the module load (same as refs.test.ts).
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { homeMarkup, homeMarkupIssues, loadHomeMarkup } from "./markup";

/** A stand-in for the Rust `profile_file` read, over a fixed set of files. */
const reader = (files: Record<string, string>) =>
  vi.fn(async (path: string) =>
    path in files
      ? { text: files[path], ok: true }
      : { text: "", ok: false as const },
  );

const FILES = {
  "community.html": "<p>Community</p>",
  "intro.html": "<h2>Intro</h2>",
};

// The module keeps what it read in a singleton, so every test loads the profile
// it is about rather than inheriting the previous one's.
afterEach(async () => {
  await loadHomeMarkup(undefined, reader({}));
});

describe("loadHomeMarkup", () => {
  it("reads nothing for a profile with no home key", async () => {
    const read = reader(FILES);
    await loadHomeMarkup(undefined, read);
    expect(read).not.toHaveBeenCalled();
  });

  it("reads nothing when no entry references a file", async () => {
    const read = reader(FILES);
    await loadHomeMarkup(
      { zones: [{ zone: "cards", before: "<p>Pick a tool</p>" }] },
      read,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a reference from before, after and html alike", async () => {
    const read = reader(FILES);
    await loadHomeMarkup(
      {
        zones: [
          { zone: "cards", before: "@.coilbox/intro.html" },
          { html: "@.coilbox/community.html" },
        ],
      },
      read,
    );
    expect(read.mock.calls.map(([p]) => p)).toEqual([
      "intro.html",
      "community.html",
    ]);
  });

  it("reads the markup around a custom entry, which renders it", async () => {
    const read = reader(FILES);
    await loadHomeMarkup(
      { zones: [{ html: "<p>Feed</p>", before: "@.coilbox/intro.html" }] },
      read,
    );
    expect(read.mock.calls.map(([p]) => p)).toEqual(["intro.html"]);
  });

  it("reads no file for a key the entry does not render", async () => {
    // `html` on a built-in zone is not drawn, so reading it would cost a disk
    // read for markup nobody sees (issue #1094).
    const read = reader(FILES);
    await loadHomeMarkup(
      { zones: [{ zone: "cards", html: "@.coilbox/community.html" }] },
      read,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("reads no file for an entry the page drops", async () => {
    const read = reader(FILES);
    await loadHomeMarkup(
      {
        zones: [
          { zone: "livestream", before: "@.coilbox/intro.html" },
          { before: "@.coilbox/community.html" },
        ],
      },
      read,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a reference used twice only once", async () => {
    const read = reader(FILES);
    await loadHomeMarkup(
      {
        zones: [
          { zone: "cards", after: "@.coilbox/intro.html" },
          { zone: "suggested", before: " @.coilbox/intro.html " },
        ],
      },
      read,
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("ignores entries and values that are not markup", async () => {
    const read = reader(FILES);
    await loadHomeMarkup(
      { zones: ["cards", null, 3, { zone: "cards", before: 7 }] },
      read,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("survives a zones key that is not an array", async () => {
    const read = reader(FILES);
    await loadHomeMarkup({ zones: { zone: "cards" } }, read);
    await loadHomeMarkup("stacked", read);
    expect(read).not.toHaveBeenCalled();
  });

  it("forgets what a previous profile referenced", async () => {
    await loadHomeMarkup(
      { zones: [{ html: "@.coilbox/community.html" }] },
      reader(FILES),
    );
    await loadHomeMarkup({ zones: [{ zone: "cards" }] }, reader(FILES));
    expect(homeMarkup("@.coilbox/community.html").html).toBeUndefined();
  });
});

describe("homeMarkup", () => {
  it("returns inline markup as its own answer", () => {
    expect(homeMarkup("<p>Pick a tool</p>")).toEqual({
      html: "<p>Pick a tool</p>",
    });
  });

  it("returns the text of a reference that was read", async () => {
    await loadHomeMarkup(
      { zones: [{ html: "@.coilbox/community.html" }] },
      reader(FILES),
    );
    expect(homeMarkup("@.coilbox/community.html")).toEqual({
      html: "<p>Community</p>",
    });
  });

  it("matches a reference whatever whitespace surrounds it", async () => {
    await loadHomeMarkup(
      { zones: [{ html: " @.coilbox/community.html " }] },
      reader(FILES),
    );
    expect(homeMarkup("@.coilbox/community.html ").html).toBe(
      "<p>Community</p>",
    );
  });

  it("reports a file that does not exist", async () => {
    await loadHomeMarkup(
      { zones: [{ html: "@.coilbox/missing.html" }] },
      reader(FILES),
    );
    expect(homeMarkup("@.coilbox/missing.html")).toEqual({
      error: "Could not read @.coilbox/missing.html",
    });
  });

  it("reports a reference that escapes the portable root", async () => {
    const read = reader(FILES);
    await loadHomeMarkup({ zones: [{ html: "@.coilbox/../secret" }] }, read);
    expect(homeMarkup("@.coilbox/../secret").html).toBeUndefined();
    expect(homeMarkup("@.coilbox/../secret").error).toContain("@.coilbox/..");
    expect(read).not.toHaveBeenCalled();
  });

  it("reports an unknown namespace rather than injecting the token", () => {
    // Nothing read it, because `markupRefs` only collects `@` values and
    // `resolveFileRef` rejects the ones that are not file refs.
    expect(homeMarkup("@route/singleplayer").html).toBeUndefined();
    expect(homeMarkup("@route/singleplayer").error).toBeTruthy();
  });

  it("draws nothing for an empty string", () => {
    expect(homeMarkup("")).toEqual({ html: "" });
  });

  it("passes malformed markup through for the browser to repair", () => {
    // The parse in `rewriteBrandedHtml` is the browser's own, so an unclosed tag
    // is normalised the way it would be in a page rather than throwing.
    expect(homeMarkup("<p>oops<div>").html).toBe("<p>oops<div>");
  });
});

/**
 * What the profile health panel lists (issue #1080). It reads the same map the
 * page renders from, so the panel names a file if and only if the page has a gap
 * where that file should be.
 */
describe("homeMarkupIssues", () => {
  const HOME = {
    zones: [
      { zone: "cards", before: "@.coilbox/intro.html" },
      { html: "@.coilbox/missing.html" },
      { zone: "suggested", after: "<p>inline</p>" },
    ],
  };

  it("says nothing for a profile with no home key", async () => {
    await loadHomeMarkup(undefined, reader(FILES));
    expect(homeMarkupIssues(undefined)).toStrictEqual([]);
  });

  it("says nothing when every reference was read", async () => {
    const home = { zones: [{ html: "@.coilbox/community.html" }] };
    await loadHomeMarkup(home, reader(FILES));
    expect(homeMarkupIssues(home)).toStrictEqual([]);
  });

  it("names the file that was not there, once", async () => {
    await loadHomeMarkup(HOME, reader(FILES));
    expect(homeMarkupIssues(HOME)).toStrictEqual([
      "Could not read @.coilbox/missing.html",
    ]);
  });

  it("says exactly what the page shows in the gap", async () => {
    await loadHomeMarkup(HOME, reader(FILES));
    expect(homeMarkupIssues(HOME)).toStrictEqual([
      homeMarkup("@.coilbox/missing.html").error,
    ]);
  });

  it("ignores inline markup, which reads no file", async () => {
    const home = { zones: [{ zone: "cards", before: "<p>hi</p>" }] };
    await loadHomeMarkup(home, reader(FILES));
    expect(homeMarkupIssues(home)).toStrictEqual([]);
  });

  it("reports a reference that escapes the portable root", async () => {
    const home = { zones: [{ html: "@.coilbox/../secret" }] };
    await loadHomeMarkup(home, reader(FILES));
    expect(homeMarkupIssues(home)).toHaveLength(1);
  });

  it("says nothing about a file named by a key the page never draws", async () => {
    // Naming it would tell the author a file at that path would have worked,
    // and nothing renders `html` on a built-in zone whether it is there or not
    // (issue #1094). The panel says the key does nothing instead, from the
    // resolver, which is the complaint that has a fix in it.
    const home = { zones: [{ zone: "cards", html: "@.coilbox/missing.html" }] };
    await loadHomeMarkup(home, reader(FILES));
    expect(homeMarkupIssues(home)).toStrictEqual([]);
  });
});
