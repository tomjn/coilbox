import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { barFormat } from "./bar";
import { buildGridSnap } from "./footprint";
import type { StoredBlueprint } from "./library";
import {
  orderPack,
  type PackConverted,
  type PackPick,
  packChanges,
  packConversionNotes,
  packCounts,
  packPlan,
  packSideOffer,
  packStrips,
  packWriteSummary,
  readBlueprintPack,
} from "./pack";
import { type SubstitutionReport, sideUnitPrefixes } from "./substitution";
import { knownUnits } from "./units";

/** A conversion that did nothing, for the two rows that say why not. */
const EMPTY_REPORT: SubstitutionReport = {
  substituted: [],
  kept: [],
  moved: [],
  overlapping: [],
  checked: true,
};

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

/* -------------------------------------------------------------------------- *
 * Taking the whole pack as one side (issue #1492).
 *
 * The fixture is what a pack really looks like: six Armada layouts, one Cortex
 * one somebody dropped in, and one with a Legion mex in it whose side therefore
 * cannot be told. A choice has to say what it does to all three kinds.
 * -------------------------------------------------------------------------- */
describe("taking a pack as one side", () => {
  const SIDES = sideUnitPrefixes([
    { name: "Armada", startUnit: "armcom" },
    { name: "Cortex", startUnit: "corcom" },
  ]);

  /** Both sides installed, which is what a real game looks like. `corllt` is
   *  left out on purpose, so "Front line" is a layout Cortex has only part of. */
  const BOTH = [
    ...UNITS,
    { name: "corsolar", footprintX: 4, footprintZ: 4 },
    { name: "cormex", footprintX: 3, footprintZ: 3 },
    { name: "corwin", footprintX: 3, footprintZ: 3 },
    { name: "corlab", footprintX: 8, footprintZ: 6 },
  ];
  const bothKnown = knownUnits(BOTH);
  const bothFootprints = (def: string) => {
    const unit = BOTH.find((one) => one.name === def.toLowerCase());
    return { x: unit?.footprintX ?? 1, z: unit?.footprintZ ?? 1 };
  };
  const entries = () => pack().entries;

  function taken(toSide: string): PackPick[] {
    return packPlan({
      entries: entries(),
      taking: new Set<number>(),
      taken: [],
      installed: INSTALLED,
      known: bothKnown,
      footprintOf: bothFootprints,
      gameName: GAME,
      conversion: {
        toSide,
        sides: SIDES,
        footprintOf: bothFootprints,
      },
    });
  }

  const row = (picks: PackPick[], name: string) =>
    picks.find((pick) => pick.entry.name === name);

  describe("packSideOffer", () => {
    it("counts what a side would do to the whole pack in one go", () => {
      // "Big wall" is every one of this game's light laser towers and Cortex
      // has none, so it is the one a Cortex choice can do nothing for.
      const offer = packSideOffer(entries(), SIDES, bothKnown);
      expect(offer?.from).toEqual(["Armada", "Cortex"]);
      expect(offer?.sideUnknown).toBe(0);
      expect(offer?.choices).toEqual([
        { side: "Armada", converts: 1, already: 7, untouched: 0 },
        { side: "Cortex", converts: 6, already: 1, untouched: 1 },
      ]);
    });

    it("counts a layout of two sides' buildings, whose own side is unanswerable", () => {
      // Still converted, because a target side is a target rather than a swap:
      // whatever is Armada's in it becomes Cortex's and the rest stays. What
      // cannot be answered is which side it was, and that is said as its own
      // number rather than folded into the counts.
      const mixed = [
        { buildings: [{ def: "armsolar" }, { def: "corsolar" }] },
        { buildings: [{ def: "armmex" }] },
      ];
      const offer = packSideOffer(mixed, SIDES, bothKnown);
      expect(offer?.from).toEqual(["Armada"]);
      expect(offer?.sideUnknown).toBe(1);
      expect(offer?.choices).toEqual([
        { side: "Armada", converts: 1, already: 1, untouched: 0 },
        { side: "Cortex", converts: 2, already: 0, untouched: 0 },
      ]);
    });

    it("offers only the side this game has the buildings for", () => {
      // No Cortex units in this dataset at all, so taking the pack as Cortex is
      // not an answer rather than an answer that would do nothing.
      expect(packSideOffer(entries(), SIDES, KNOWN)?.choices).toEqual([
        { side: "Armada", converts: 1, already: 7, untouched: 0 },
      ]);
    });

    it("offers nothing at all when the game's sides cannot be told apart", () => {
      expect(packSideOffer(entries(), [], bothKnown)).toBeUndefined();
    });
  });

  describe("packPlan over a whole pack", () => {
    it("keeps every layout as it is when no side is picked", () => {
      expect(plan()[0].converted).toBeUndefined();
      expect(plan()[0].payload.buildings[0].def).toBe("armsolar");
    });

    it("says the layout it converted in the buildings it converted it to", () => {
      const done = row(taken("Cortex"), "Wind farm");
      expect(done?.converted?.state).toBe("converted");
      expect(done?.payload.buildings.map((building) => building.def)).toEqual([
        "corwin",
        "corwin",
        "corwin",
        "corwin",
      ]);
    });

    it("leaves a layout already that side's alone, and says so", () => {
      const done = row(taken("Cortex"), "Cortex opening");
      expect(done?.converted?.state).toBe("already");
      expect(done?.payload.buildings[0].def).toBe("corsolar");
    });

    it("says plainly that a layout it can do nothing for was left alone", () => {
      // Nothing is called `corllt` in this game, so a wall of Armada's turrets
      // stays a wall of Armada's turrets and the row says which it was.
      const done = row(taken("Cortex"), "Big wall");
      expect(done?.converted?.state).toBe("cannot");
      expect(done?.payload.buildings.every((one) => one.def === "armllt")).toBe(
        true,
      );
    });

    it("leaves a building belonging to no side alone rather than guessing", () => {
      // `legmex` is neither side's as far as this game's naming goes, so it is
      // not the conversion's to touch. The rest of the layout still converts.
      const done = row(taken("Cortex"), "Lab corner");
      expect(done?.payload.buildings.map((one) => one.def)).toEqual([
        "corlab",
        "corsolar",
        "legmex",
      ]);
    });

    it("converts what it can of a layout this game has only part of", () => {
      // `corllt` is not in this game, so the two turrets stay Armada's and the
      // solar becomes Cortex's. Half a conversion said out loud beats a refusal.
      const done = row(taken("Cortex"), "Front line");
      expect(done?.converted?.report.substituted).toHaveLength(1);
      expect(done?.payload.buildings.map((one) => one.def)).toEqual([
        "armllt",
        "armllt",
        "corsolar",
      ]);
    });

    it("checks the converted layout rather than the one that arrived", () => {
      // The pack's Cortex layout cannot be placed in a game with no Cortex
      // units, and taking the pack as Armada is exactly what fixes that.
      expect(row(plan(), "Cortex opening")?.fit).toBe("none");
      const done = packPlan({
        entries: entries(),
        taking: new Set<number>(),
        taken: [],
        installed: INSTALLED,
        known: KNOWN,
        footprintOf,
        gameName: GAME,
        conversion: { toSide: "Armada", sides: SIDES, footprintOf },
      });
      expect(row(done, "Cortex opening")?.fit).toBe("all");
    });

    it("converts nothing before the game's units have been read", () => {
      const done = packPlan({
        entries: entries(),
        taking: new Set<number>(),
        taken: [],
        installed: INSTALLED,
        gameName: GAME,
        conversion: { toSide: "Cortex", sides: SIDES },
      });
      expect(done[0].converted).toBeUndefined();
    });
  });

  describe("packConversionNotes", () => {
    it("says how much of a layout changed", () => {
      const done = row(taken("Cortex"), "Wind farm");
      const notes = packConversionNotes(
        done?.converted as PackConverted,
        "Cortex",
        4,
      );
      expect(notes[0].text).toBe("4 of 4 buildings said in Cortex.");
    });

    it("warns when the substitutes will not stand where the layout does", () => {
      // A Cortex wind generator covers three squares to Armada's two, so a farm
      // packed tight cannot stay packed tight.
      const done = row(taken("Cortex"), "Wind farm");
      const notes = packConversionNotes(
        done?.converted as PackConverted,
        "Cortex",
        4,
      );
      expect(notes.some((note) => note.tone === "warn")).toBe(true);
    });

    it("says a layout it did nothing to was left alone, and why", () => {
      expect(
        packConversionNotes(
          { state: "already", report: EMPTY_REPORT },
          "Cortex",
          3,
        )[0].text,
      ).toBe("Already Cortex's.");
      expect(
        packConversionNotes(
          { state: "cannot", report: EMPTY_REPORT },
          "Cortex",
          3,
        )[0].text,
      ).toContain("Nothing in it could be said in Cortex");
    });
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

/** A layout as the library keeps one, for the writing half (issue #1474). */
const kept = (
  patch: Partial<StoredBlueprint["layout"]> = {},
): StoredBlueprint => ({
  id: crypto.randomUUID(),
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  layout: {
    name: "Opening solars",
    buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
    footprints: {},
    ...patch,
  },
});

describe("packStrips", () => {
  it("names everything a game's file has nowhere to keep", () => {
    const said = packStrips([
      kept({
        game: { name: GAME, shortname: "BA" },
        designedFor: "Comet Catcher Remake",
        footprints: { armsolar: { x: 4, z: 4 } },
      }),
      kept({ game: { name: GAME, shortname: "BA" } }),
    ]);
    expect(said).toEqual([
      "the map 1 blueprint was designed for",
      "which game 2 blueprints are for",
      "the footprints 1 blueprint carries",
    ]);
  });

  it("says nothing when there is nothing to leave behind", () => {
    expect(packStrips([kept()])).toEqual([]);
  });
});

describe("packWriteSummary", () => {
  it("counts what the write did to the file", () => {
    expect(
      packWriteSummary("/games/blueprints.json", {
        added: ["Wall", "Opening solars"],
        replaced: ["Front line"],
        kept: 0,
      }),
    ).toBe(
      "Wrote into /games/blueprints.json: added 2 blueprints and replaced 1 blueprint.",
    );
  });

  it("says where the file it was is kept, and what was left untouched", () => {
    const said = packWriteSummary("/games/blueprints.json", {
      added: ["Wall"],
      replaced: [],
      kept: 2,
      backup: "/games/blueprints.json.20260813-090530.bak",
    });
    expect(said).toContain("added 1 blueprint.");
    expect(said).toContain(
      "The file it was is kept at /games/blueprints.json.20260813-090530.bak.",
    );
    expect(said).toContain("2 entries coilbox cannot read were left");
  });
});
