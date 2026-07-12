import { describe, expect, it, vi } from "vitest";

// ignore.ts imports `useSetting` from @picoframe/frame and (for the server-sync
// actions) the command bindings, which pull in @picoframe/plugin-sdk. Both published
// dists use extensionless relative imports Vitest's node resolver won't load. These
// pure-helper tests never call the hook or a command, so stubbing the leaf packages
// is enough to let the module import (same pattern as store.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { addIgnore, ignoredFor, isIgnored, removeIgnore } from "./ignore";

const KEY = "me@host:8200";
const OTHER = "me@other:8200";

describe("addIgnore", () => {
  it("adds a name to a serverKey's list", () => {
    expect(addIgnore({}, KEY, "Bob")).toEqual({ [KEY]: ["Bob"] });
  });

  it("dedupes case-insensitively, keeping the stored casing", () => {
    const map = { [KEY]: ["Bob"] };
    expect(addIgnore(map, KEY, "bob")).toBe(map);
    expect(addIgnore(map, KEY, "BOB")).toEqual({ [KEY]: ["Bob"] });
  });

  it("trims and skips blank names", () => {
    expect(addIgnore({}, KEY, "  ")).toEqual({});
    expect(addIgnore({}, KEY, "  Bob  ")).toEqual({ [KEY]: ["Bob"] });
  });

  it("keeps serverKeys isolated", () => {
    const map = addIgnore({ [KEY]: ["Bob"] }, OTHER, "Alice");
    expect(map).toEqual({ [KEY]: ["Bob"], [OTHER]: ["Alice"] });
  });
});

describe("removeIgnore", () => {
  it("removes a name case-insensitively", () => {
    expect(removeIgnore({ [KEY]: ["Bob", "Alice"] }, KEY, "bob")).toEqual({
      [KEY]: ["Alice"],
    });
  });

  it("leaves the list unchanged when the name is absent", () => {
    expect(removeIgnore({ [KEY]: ["Bob"] }, KEY, "nope")).toEqual({
      [KEY]: ["Bob"],
    });
  });

  it("only affects the given serverKey", () => {
    const map = { [KEY]: ["Bob"], [OTHER]: ["Bob"] };
    expect(removeIgnore(map, KEY, "Bob")).toEqual({
      [KEY]: [],
      [OTHER]: ["Bob"],
    });
  });
});

describe("isIgnored", () => {
  it("matches case-insensitively", () => {
    const map = { [KEY]: ["Bob"] };
    expect(isIgnored(map, KEY, "bob")).toBe(true);
    expect(isIgnored(map, KEY, "BOB")).toBe(true);
    expect(isIgnored(map, KEY, "Alice")).toBe(false);
  });

  it("is false for an unknown serverKey", () => {
    expect(isIgnored({ [KEY]: ["Bob"] }, OTHER, "Bob")).toBe(false);
  });

  it("toggles: add then remove clears membership", () => {
    let map: Record<string, string[]> = {};
    map = addIgnore(map, KEY, "Bob");
    expect(isIgnored(map, KEY, "Bob")).toBe(true);
    map = removeIgnore(map, KEY, "Bob");
    expect(isIgnored(map, KEY, "Bob")).toBe(false);
  });
});

describe("ignoredFor", () => {
  it("returns the raw list for a serverKey", () => {
    expect(ignoredFor({ [KEY]: ["Bob", "Alice"] }, KEY)).toEqual([
      "Bob",
      "Alice",
    ]);
  });

  it("returns an empty list for a missing serverKey", () => {
    expect(ignoredFor({}, KEY)).toEqual([]);
  });
});
