import { describe, expect, it } from "vitest";

import {
  type InventoryRef,
  inList,
  parseRefs,
  RECENT_LIMIT,
  refKey,
  withRecent,
  withToggled,
} from "./inventory";

const part = (id: string): InventoryRef => ({ kind: "part", id });
const module = (id: string): InventoryRef => ({ kind: "module", id });

describe("recent items", () => {
  it("puts the newest first", () => {
    expect(withRecent([part("a")], part("b"))).toEqual([part("b"), part("a")]);
  });

  it("moves an item used again to the front instead of listing it twice", () => {
    expect(withRecent([part("a"), part("b")], part("b"))).toEqual([
      part("b"),
      part("a"),
    ]);
  });

  it("keeps a part and a module with the same id apart", () => {
    expect(withRecent([part("x")], module("x"))).toEqual([
      module("x"),
      part("x"),
    ]);
  });

  it("drops the oldest past the limit", () => {
    let list: InventoryRef[] = [];
    for (let i = 0; i < RECENT_LIMIT + 5; i++)
      list = withRecent(list, part(`p${i}`));
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toEqual(part(`p${RECENT_LIMIT + 4}`));
    expect(list.at(-1)).toEqual(part("p5"));
  });
});

describe("favourites", () => {
  it("adds an item, then removes it on the second toggle", () => {
    const once = withToggled([], module("m"));
    expect(once).toEqual([module("m")]);
    expect(withToggled(once, module("m"))).toEqual([]);
  });
});

describe("reading the stored lists", () => {
  it("returns nothing for a value that is not a list", () => {
    expect(parseRefs(null)).toEqual([]);
    expect(parseRefs("part:a")).toEqual([]);
    expect(parseRefs({ kind: "part", id: "a" })).toEqual([]);
  });

  it("skips malformed entries and repeats", () => {
    expect(
      parseRefs([
        part("a"),
        { kind: "skeleton", id: "s" },
        { kind: "part" },
        null,
        7,
        part("a"),
        module("m"),
      ]),
    ).toEqual([part("a"), module("m")]);
  });

  it("keeps a shape, which is referenced by its kind", () => {
    expect(parseRefs([{ kind: "shape", id: "cylinder" }])).toEqual([
      { kind: "shape", id: "cylinder" },
    ]);
  });

  it("keys a part and a module with the same id differently", () => {
    expect(refKey(part("x"))).not.toBe(refKey(module("x")));
  });
});

describe("narrowing to a list", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const idOf = (item: { id: string }) => item.id;

  it("shows everything for the full list", () => {
    expect(inList(items, "all", "part", idOf, [], [])).toBe(items);
  });

  it("orders recent items newest first, whatever the grid order", () => {
    const recent = [part("c"), part("a")];
    expect(inList(items, "recent", "part", idOf, recent, []).map(idOf)).toEqual(
      ["c", "a"],
    );
  });

  it("ignores recent items of the other kind", () => {
    expect(inList(items, "recent", "part", idOf, [module("a")], [])).toEqual(
      [],
    );
  });

  it("drops a recent or favourite item that is no longer installed", () => {
    const gone = [part("deleted"), part("b")];
    expect(inList(items, "recent", "part", idOf, gone, []).map(idOf)).toEqual([
      "b",
    ]);
    expect(
      inList(items, "favourites", "part", idOf, [], gone).map(idOf),
    ).toEqual(["b"]);
  });

  it("keeps the grid order for favourites", () => {
    const stars = [part("c"), part("a")];
    expect(
      inList(items, "favourites", "part", idOf, [], stars).map(idOf),
    ).toEqual(["a", "c"]);
  });
});
