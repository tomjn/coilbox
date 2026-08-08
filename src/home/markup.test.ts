import { afterEach, describe, expect, it, vi } from "vitest";

// markup.ts reaches `profile_file` through refs.ts, which imports defineCommand
// from @picoframe/plugin-sdk, whose published dist will not load under Vitest's
// node resolver. Every test here injects its own reader, so stubbing the leaf
// only lets the module load (same as refs.test.ts).
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { homeMarkup, loadHomeMarkup } from "./markup";

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
