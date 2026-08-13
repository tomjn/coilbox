import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { barFormat } from "./bar";
import { buildGridSnap } from "./footprint";
import {
  orderPack,
  packChanges,
  packCounts,
  packPlan,
  type PackPick,
  readBlueprintPack,
} from "./pack";
import { knownUnits } from "./units";

/** A file of the shape somebody downloads from the community gallery: a pile of
 *  other people's layouts, one of them another game's, two of them called the
 *  same thing, one of them nameless and one of them an entry no reader can make
 *  a layout of. */
const PACK = readFileSync(join(__dirname, "fixtures", "bar-pack.json"), "utf8");

const GAME = "Balanced Antihilation test-1";
const INSTALLED = [{ name: GAME, info: { shortname: "BA" } }];

const UNITS = [
  { name: "armsolar", footprintX: 4, footprintZ: 4 },
  { name: "armmex", footprintX: 3, footprintZ: 3 },
  { name: "armwin", footprintX: 2, footprintZ: 2 },
  { name: "armllt", footprintX: 2, footprintZ: 2 },
  { name: "armlab", footprintX: 8, footprintZ: 6 },
];

const KNOWN = knownUnits(UNITS);

const footprintOf = (def: string) => {
  const unit = UNITS.find((one) => one.name === def.toLowerCase());
  return { x: unit?.footprintX ?? 1, z: unit?.footprintZ ?? 1 };
};

function pack(snap?: ReturnType<typeof buildGridSnap>) {
  return readBlueprintPack(barFormat, PACK, snap);
}

function plan(
  taking: Iterable<number> = [],
  taken: string[] = [],
  known: typeof KNOWN | undefined = KNOWN,
): PackPick[] {
  return packPlan({
    entries: pack().entries,
    taking: new Set(taking),
    taken,
    installed: INSTALLED,
    known,
    footprintOf,
    gameName: GAME,
  });
}

const named = (picks: PackPick[]) => picks.map((pick) => pick.entry.name);

describe("readBlueprintPack", () => {
  it("reads every layout in the file and counts the one it cannot", () => {
    const read = pack();
    expect(read.entries).toHaveLength(8);
    expect(read.unreadable).toBe(1);
  });

  it("keeps where each layout stood, which is what tells two of a name apart", () => {
    const read = pack();
    expect(read.entries.map((entry) => entry.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    const solars = read.entries.filter(
      (entry) => entry.name === "Opening solars",
    );
    expect(solars.map((entry) => entry.index)).toEqual([0, 6]);
  });

  it("names a nameless entry the way the game refers to it", () => {
    expect(named(plan())).toContain("#6");
  });
});

describe("packPlan", () => {
  it("says which of them this game can place", () => {
    const fits = new Map(
      plan().map((pick) => [pick.entry.name, pick.fit] as const),
    );
    expect(fits.get("Wind farm")).toBe("all");
    expect(fits.get("Lab corner")).toBe("some");
    expect(fits.get("Cortex opening")).toBe("none");
  });

  it("checks nothing when the game's units have not been read", () => {
    expect(plan([], [], undefined).every((pick) => pick.fit === "unchecked"));
  });

  it("names what is wrong with a layout that half fits", () => {
    const pick = plan().find((one) => one.entry.name === "Lab corner");
    expect(pick?.arrival.notes[0].tone).toBe("warn");
    expect(pick?.arrival.notes[0].text).toContain("legmex");
  });

  it("counts a name up past the library's own", () => {
    const pick = plan([0], ["Opening solars"]).find(
      (one) => one.entry.index === 0,
    );
    expect(pick?.arrival.name).toBe("Opening solars 2");
    expect(pick?.arrival.wasCalled).toBe("Opening solars");
  });

  it("counts two of one name in the pack up past each other, once taken", () => {
    const both = plan([0, 6], ["Opening solars"]);
    expect(both.find((one) => one.entry.index === 0)?.arrival.name).toBe(
      "Opening solars 2",
    );
    expect(both.find((one) => one.entry.index === 6)?.arrival.name).toBe(
      "Opening solars 3",
    );
  });

  it("does not let a layout nobody is taking claim a name", () => {
    const one = plan([6], ["Opening solars"]);
    expect(one.find((pick) => pick.entry.index === 6)?.arrival.name).toBe(
      "Opening solars 2",
    );
  });

  it("carries the footprints and the game, so a taken layout is drawn right", () => {
    const pick = plan().find((one) => one.entry.name === "Lab corner");
    expect(pick?.payload.footprints.armlab).toEqual({ x: 8, z: 6 });
    expect(pick?.payload.game?.name).toBe(GAME);
    // A unit this game has not got has no footprint to state, and one square is
    // what a reader falls back to.
    expect(pick?.payload.footprints.legmex).toEqual({ x: 1, z: 1 });
  });

  it("keeps the build order of a layout that meant one", () => {
    const picks = plan();
    expect(
      picks.find((one) => one.entry.name === "Opening solars")?.payload.ordered,
    ).toBe(true);
    expect(
      picks.find((one) => one.entry.name === "Wind farm")?.payload.ordered,
    ).toBeUndefined();
  });
});

describe("orderPack", () => {
  it("leaves the file's own order alone", () => {
    expect(orderPack(plan(), "file").map((pick) => pick.entry.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("sinks the ones that cannot be placed here", () => {
    const order = orderPack(plan(), "fit");
    expect(order[order.length - 1].entry.name).toBe("Cortex opening");
    // Everything else keeps the file's order, so nothing else moves under the
    // reader's eye.
    expect(order.slice(0, -1).map((pick) => pick.entry.index)).toEqual([
      0, 1, 2, 4, 5, 6, 7,
    ]);
  });

  it("puts the biggest first when asked", () => {
    expect(orderPack(plan(), "size")[0].entry.name).toBe("Big wall");
  });

  it("sorts by the name in the file, which does not move as you tick", () => {
    const order = orderPack(plan([0, 6], ["Opening solars"]), "name");
    expect(named(order)).toEqual([
      "#6",
      "Big wall",
      "Cortex opening",
      "Front line",
      "Lab corner",
      "Opening solars",
      "Opening solars",
      "Wind farm",
    ]);
  });
});

describe("packCounts", () => {
  it("counts what is worth taking, what is not, and what is ticked", () => {
    expect(packCounts(plan([0, 1]))).toEqual({
      total: 8,
      placeable: 7,
      unplaceable: 1,
      taking: 2,
    });
  });
});

describe("packChanges", () => {
  it("says what reading the whole file changed, once rather than per layout", () => {
    const said = packChanges(pack(buildGridSnap(UNITS)));
    expect(said).toContain("1 of them");
    expect(said).toContain("turned");
    expect(said).toContain("build grid");
    expect(said).toContain("the 2 square gap it repeats at");
  });

  it("says nothing about a file it read exactly as it stood", () => {
    const read = readBlueprintPack(barFormat, '{"savedBlueprints":[]}');
    expect(packChanges(read)).toBeNull();
  });
});
