import { describe, expect, it, vi } from "vitest";

// friends.ts imports `useSetting` from @picoframe/frame, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load. These
// pure-helper tests never call the hook, so stubbing the leaf package is enough
// to let the module import (same pattern as channels.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));

import {
  addFavourite,
  favouritesFor,
  isFavourite,
  removeFavourite,
} from "./friends";

const KEY = "me@host:8200";
const OTHER = "me@other:8200";

describe("favouritesFor", () => {
  it("returns the list for a server", () => {
    expect(favouritesFor({ [KEY]: ["alice"] }, KEY)).toEqual(["alice"]);
  });

  it("returns an empty list for an unknown server", () => {
    expect(favouritesFor({}, KEY)).toEqual([]);
  });
});

describe("isFavourite", () => {
  it("is true for a stored name", () => {
    expect(isFavourite({ [KEY]: ["alice"] }, KEY, "alice")).toBe(true);
  });

  it("is false for an absent name", () => {
    expect(isFavourite({ [KEY]: ["alice"] }, KEY, "bob")).toBe(false);
  });

  it("is false on a different server", () => {
    expect(isFavourite({ [KEY]: ["alice"] }, OTHER, "alice")).toBe(false);
  });
});

describe("addFavourite", () => {
  it("adds a name to an empty map", () => {
    expect(addFavourite({}, KEY, "alice")).toEqual({ [KEY]: ["alice"] });
  });

  it("keeps the list sorted", () => {
    const map = addFavourite({ [KEY]: ["bob"] }, KEY, "alice");
    expect(map[KEY]).toEqual(["alice", "bob"]);
  });

  it("dedupes an existing name", () => {
    const map = { [KEY]: ["alice"] };
    expect(addFavourite(map, KEY, "alice")).toEqual({ [KEY]: ["alice"] });
  });

  it("isolates favourites per server", () => {
    const map = addFavourite({ [KEY]: ["alice"] }, OTHER, "bob");
    expect(map).toEqual({ [KEY]: ["alice"], [OTHER]: ["bob"] });
  });
});

describe("removeFavourite", () => {
  it("removes a name", () => {
    expect(removeFavourite({ [KEY]: ["alice", "bob"] }, KEY, "alice")).toEqual({
      [KEY]: ["bob"],
    });
  });

  it("leaves the map unchanged when the name is absent", () => {
    const map = { [KEY]: ["alice"] };
    expect(removeFavourite(map, KEY, "bob")).toBe(map);
  });

  it("does not touch other servers", () => {
    const map = { [KEY]: ["alice"], [OTHER]: ["alice"] };
    expect(removeFavourite(map, KEY, "alice")).toEqual({
      [KEY]: [],
      [OTHER]: ["alice"],
    });
  });
});

describe("toggle round-trip", () => {
  it("adds then removes back to empty", () => {
    const added = addFavourite({}, KEY, "alice");
    expect(isFavourite(added, KEY, "alice")).toBe(true);
    const removed = removeFavourite(added, KEY, "alice");
    expect(isFavourite(removed, KEY, "alice")).toBe(false);
  });
});
