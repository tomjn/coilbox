import { describe, expect, it } from "vitest";
import {
  duplicatedBlueprint,
  libraryGames,
  libraryLayout,
  newStoredBlueprint,
  parseStoredBlueprintJson,
  recordGameName,
  recordWithLayout,
  type StoredBlueprint,
  sortLibrary,
  uniqueLayoutName,
} from "./library";
import type { BaseBlueprint } from "./model";

const record = (patch: Partial<StoredBlueprint> = {}): StoredBlueprint => ({
  id: "b1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  layout: {
    game: { name: "Beyond All Reason test-1", shortname: "BAR" },
    name: "Opening solars",
    buildings: [
      { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
      { def: "armlab", offset: { x: 96, z: 0 }, facing: 1 },
    ],
    footprints: { armsolar: { x: 4, z: 4 }, armlab: { x: 8, z: 6 } },
  },
  ...patch,
});

describe("newStoredBlueprint", () => {
  it("starts empty, named, and bound to the game it was made for", () => {
    const made = newStoredBlueprint("My opening", "Beyond All Reason test-1");
    expect(made.layout.name).toBe("My opening");
    expect(made.layout.buildings).toEqual([]);
    expect(made.layout.game?.name).toBe("Beyond All Reason test-1");
    expect(made.id).not.toBe("");
  });

  it("names no game when it was made without one", () => {
    expect(newStoredBlueprint("Nameless", "").layout.game).toBeUndefined();
  });
});

describe("libraryLayout", () => {
  it("is the stored layout under the record's own id", () => {
    const layout = libraryLayout(record());
    expect(layout.id).toBe("b1");
    expect(layout.name).toBe("Opening solars");
    expect(layout.buildings).toHaveLength(2);
  });
});

describe("recordWithLayout", () => {
  const edited: BaseBlueprint = {
    id: "b1",
    name: "Opening solars",
    ordered: true,
    buildings: [{ def: "armsolar", offset: { x: 16, z: 0 }, facing: 2 }],
  };

  it("keeps the game and takes fresh footprints from the units", () => {
    const next = recordWithLayout(record(), edited, () => ({ x: 3, z: 3 }));
    expect(next.id).toBe("b1");
    expect(next.layout.game?.shortname).toBe("BAR");
    expect(next.layout.ordered).toBe(true);
    expect(next.layout.buildings[0].offset.x).toBe(16);
    expect(next.layout.footprints.armsolar).toEqual({ x: 3, z: 3 });
  });

  it("keeps the footprints it already had when the units cannot be read", () => {
    const next = recordWithLayout(record(), edited);
    expect(next.layout.footprints.armsolar).toEqual({ x: 4, z: 4 });
  });
});

describe("duplicatedBlueprint", () => {
  it("is the same layout under a fresh id and the next name up", () => {
    const copy = duplicatedBlueprint(record(), ["Opening solars"]);
    expect(copy.id).not.toBe("b1");
    expect(copy.layout.name).toBe("Opening solars 2");
    expect(copy.layout.buildings).toEqual(record().layout.buildings);
    expect(copy.layout.footprints).toEqual(record().layout.footprints);
    expect(copy.layout.game?.shortname).toBe("BAR");
  });

  it("is stamped by the store rather than inheriting the original's dates", () => {
    const copy = duplicatedBlueprint(record(), []);
    expect(copy.createdAt).toBe("");
    expect(copy.updatedAt).toBe("");
  });

  /** Editing the copy must not reach the layout it was made from, which it
   *  would if the two shared one buildings array. */
  it("leaves the original alone when the copy is edited", () => {
    const original = record();
    const copy = duplicatedBlueprint(original, []);
    copy.layout.buildings[0].offset.x = 999;
    copy.layout.footprints.armsolar.x = 9;
    expect(original.layout.buildings[0].offset.x).toBe(0);
    expect(original.layout.footprints.armsolar.x).toBe(4);
  });
});

describe("parseStoredBlueprintJson", () => {
  it("reads a document back", () => {
    const read = parseStoredBlueprintJson(JSON.stringify(record()));
    expect(read?.id).toBe("b1");
    expect(read?.layout.buildings).toHaveLength(2);
    expect(read?.updatedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("refuses a document with no id and one that is not a layout", () => {
    expect(parseStoredBlueprintJson("{}")).toBeNull();
    expect(
      parseStoredBlueprintJson(JSON.stringify({ ...record(), id: "" })),
    ).toBeNull();
    expect(
      parseStoredBlueprintJson(JSON.stringify({ id: "b1", layout: 7 })),
    ).toBeNull();
    expect(parseStoredBlueprintJson("not json")).toBeNull();
  });
});

describe("sortLibrary", () => {
  it("puts the most recently edited first", () => {
    const sorted = sortLibrary([
      record({ id: "old", updatedAt: "2026-08-01T00:00:00.000Z" }),
      record({ id: "new", updatedAt: "2026-08-09T00:00:00.000Z" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("libraryGames and recordGameName", () => {
  it("lists each game once, and says when a layout names none", () => {
    const nameless = record({ id: "b2" });
    nameless.layout = { ...nameless.layout, game: undefined };
    expect(libraryGames([record(), record({ id: "b3" }), nameless])).toEqual([
      "Beyond All Reason test-1",
    ]);
    expect(recordGameName(nameless)).toBe("");
  });
});

describe("uniqueLayoutName", () => {
  it("leaves a free name alone", () => {
    expect(uniqueLayoutName("Opening", ["Wall"])).toBe("Opening");
  });

  it("counts up past a name already taken, whatever its case", () => {
    expect(uniqueLayoutName("Opening", ["opening"])).toBe("Opening 2");
    expect(uniqueLayoutName("Opening", ["Opening", "Opening 2"])).toBe(
      "Opening 3",
    );
  });

  it("falls back to a name when it is given none", () => {
    expect(uniqueLayoutName("   ", [])).toBe("Untitled layout");
  });
});
