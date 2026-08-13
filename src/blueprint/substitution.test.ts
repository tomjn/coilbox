import { describe, expect, it } from "vitest";
import { buildingFootprints } from "./footprint";
import type { BaseBlueprint } from "./model";
import type { BlueprintPayload } from "./payload";
import {
  layoutDefs,
  layoutSide,
  planForSide,
  revertSubstitution,
  sideOfDef,
  sideOffer,
  sideUnitPrefixes,
  substituteBlueprint,
  substitutedCount,
  substitutePayload,
  substitutionNotes,
} from "./substitution";
import { knownUnits } from "./units";

const SIDES = [
  { name: "Armada", startUnit: "armcom" },
  { name: "Cortex", startUnit: "corcom" },
];

/** Two sides' units, with one pair that stands on the same ground and one that
 *  does not. `armllt` is the case that matters most: the layout names it and the
 *  other side has nothing called `corllt`, so there is nothing to swap it for. */
const UNITS = [
  { name: "armsolar", footprintX: 2, footprintZ: 2 },
  { name: "corsolar", footprintX: 3, footprintZ: 3 },
  { name: "armmex", footprintX: 2, footprintZ: 2 },
  { name: "cormex", footprintX: 2, footprintZ: 2 },
  { name: "armllt", footprintX: 2, footprintZ: 2 },
];

const footprintOf = buildingFootprints(UNITS);
const known = knownUnits(UNITS);
const prefixes = sideUnitPrefixes(SIDES);

/** Two solars side by side, each on the two build squares its footprint asks
 *  for, touching but not fighting over ground. */
const layout: BaseBlueprint = {
  id: "l1",
  name: "Opening solars",
  buildings: [
    { def: "armsolar", offset: { x: -16, z: 0 }, facing: 0 },
    { def: "armsolar", offset: { x: 16, z: 0 }, facing: 0 },
  ],
};

describe("sideUnitPrefixes", () => {
  it("reads each side's unit prefix off the start units they share a suffix with", () => {
    expect(sideUnitPrefixes(SIDES)).toEqual([
      { side: "Armada", prefix: "arm" },
      { side: "Cortex", prefix: "cor" },
    ]);
  });

  it("has nothing to say about a game with one side", () => {
    expect(sideUnitPrefixes([SIDES[0]])).toEqual([]);
  });

  it("has nothing to say when the start units share no ending", () => {
    expect(
      sideUnitPrefixes([
        { name: "Empire", startUnit: "empire_commander" },
        { name: "Rebels", startUnit: "rebel_hq" },
      ]),
    ).toEqual([]);
  });

  it("has nothing to say when a side's prefix would be nothing at all", () => {
    expect(
      sideUnitPrefixes([
        { name: "Armada", startUnit: "com" },
        { name: "Cortex", startUnit: "corcom" },
      ]),
    ).toEqual([]);
  });

  it("has nothing to say about a side that names no start unit", () => {
    expect(sideUnitPrefixes([{ name: "Armada" }, { name: "Cortex" }])).toEqual(
      [],
    );
    expect(sideUnitPrefixes([SIDES[0], { name: "Cortex" }])).toEqual([]);
  });

  it("says which side a def belongs to, and nothing for one belonging to none", () => {
    expect(sideOfDef("corsolar", prefixes)?.side).toBe("Cortex");
    expect(sideOfDef("ArmSolar", prefixes)?.side).toBe("Armada");
    expect(sideOfDef("raptorqueen", prefixes)).toBeUndefined();
  });
});

describe("planForSide", () => {
  it("proposes the other side's name only where the game has that unit", () => {
    expect(
      planForSide(["armsolar", "armmex", "armllt"], "Cortex", prefixes, known),
    ).toEqual({ armsolar: "corsolar", armmex: "cormex" });
  });

  it("proposes nothing for a def already on the side being converted to", () => {
    expect(planForSide(["corsolar"], "Cortex", prefixes, known)).toEqual({});
  });

  it("proposes nothing at all when the game's sides cannot be told apart", () => {
    expect(planForSide(["armsolar"], "Cortex", [], known)).toEqual({});
  });

  it("proposes nothing off a prefix the start units share by coincidence", () => {
    // "e_commander" and "rebelleader" happen to end in "der", so the prefixes
    // read off them are nonsense. Every candidate is checked against the game's
    // own units, which is what makes nonsense produce nothing rather than a
    // layout full of units nobody has.
    const odd = sideUnitPrefixes([
      { name: "Empire", startUnit: "e_commander" },
      { name: "Rebels", startUnit: "rebelleader" },
    ]);
    expect(odd).toHaveLength(2);
    expect(planForSide(["armsolar", "armmex"], "Rebels", odd, known)).toEqual(
      {},
    );
  });

  it("lists a layout's defs once each, in the order they are built", () => {
    expect(layoutDefs(layout)).toEqual(["armsolar"]);
  });
});

describe("layoutSide", () => {
  it("names the side a layout is written in", () => {
    expect(layoutSide(["armsolar", "armmex"], prefixes)?.side).toBe("Armada");
  });

  it("says nothing about a layout with both sides' buildings in it", () => {
    expect(layoutSide(["armsolar", "corsolar"], prefixes)).toBeUndefined();
  });

  it("ignores buildings belonging to no side, because nobody owns those", () => {
    expect(layoutSide(["armsolar", "raptorqueen"], prefixes)?.side).toBe(
      "Armada",
    );
  });

  it("says nothing when no building belongs to a side", () => {
    expect(layoutSide(["raptorqueen"], prefixes)).toBeUndefined();
  });

  it("says nothing when the game's sides cannot be told apart", () => {
    expect(layoutSide(["armsolar"], [])).toBeUndefined();
  });
});

describe("sideOffer", () => {
  /** A third side, so the offer has more than one answer to give. */
  const three = sideUnitPrefixes([
    ...SIDES,
    { name: "Legion", startUnit: "legcom" },
  ]);
  const withLeg = knownUnits([...UNITS, { name: "legsolar" }]);

  it("offers every side this game has a version of these buildings in", () => {
    expect(sideOffer(["armsolar"], three, withLeg)).toEqual({
      from: "Armada",
      to: ["Cortex", "Legion"],
    });
  });

  it("leaves out a side the game has no substitute in", () => {
    // Nothing is called legsolar in this dataset, so Legion is not an answer
    // rather than an answer that would do nothing.
    expect(sideOffer(["armsolar"], three, known)).toEqual({
      from: "Armada",
      to: ["Cortex"],
    });
  });

  it("offers nothing when the layout's own side cannot be told", () => {
    expect(sideOffer(["armsolar", "corsolar"], three, withLeg)).toBeUndefined();
  });

  it("offers nothing when the game's units have not been read", () => {
    expect(sideOffer(["armsolar"], three, knownUnits([]))).toBeUndefined();
  });
});

describe("substitutePayload", () => {
  const payload: BlueprintPayload = {
    game: { name: "Beyond All Reason test-1" },
    name: "Opening solars",
    buildings: [
      { def: "armsolar", offset: { x: -16, z: 0 }, facing: 0 },
      { def: "armmex", offset: { x: 96, z: 0 }, facing: 0 },
    ],
    footprints: { armsolar: { x: 2, z: 2 }, armmex: { x: 2, z: 2 } },
  };

  it("swaps the names and keeps what each building was drawn as", () => {
    const { payload: out } = substitutePayload(
      payload,
      { armsolar: "corsolar" },
      footprintOf,
    );
    expect(out.buildings.map((b) => b.def)).toEqual(["corsolar", "armmex"]);
    expect(out.buildings[0].originalName).toBe("armsolar");
    expect(out.name).toBe("Opening solars");
    expect(out.game).toEqual(payload.game);
  });

  it("records what the substitutes stand on, so a reader can draw them", () => {
    const { payload: out } = substitutePayload(
      payload,
      { armsolar: "corsolar" },
      footprintOf,
    );
    expect(out.footprints.corsolar).toEqual({ x: 3, z: 3 });
    expect(out.footprints.armsolar).toEqual({ x: 2, z: 2 });
  });

  it("leaves the footprints alone when nothing has read them", () => {
    const { payload: out, report } = substitutePayload(payload, {
      armsolar: "corsolar",
    });
    expect(out.footprints).toEqual(payload.footprints);
    expect(report.checked).toBe(false);
  });
});

describe("substituteBlueprint", () => {
  const plan = { armsolar: "corsolar" };

  it("swaps the names and keeps what each building was drawn as", () => {
    const { layout: out } = substituteBlueprint(layout, plan, footprintOf);
    expect(out.buildings.map((b) => b.def)).toEqual(["corsolar", "corsolar"]);
    expect(out.buildings.map((b) => b.originalName)).toEqual([
      "armsolar",
      "armsolar",
    ]);
    expect(substitutedCount(out)).toBe(2);
  });

  it("says which buildings move, and which now fight over ground, when the substitute stands on more", () => {
    const { layout: out, report } = substituteBlueprint(
      layout,
      plan,
      footprintOf,
    );
    // A 3 square footprint centres in the middle of a build square where a 2
    // square one centres on the corner, so neither building is where it was.
    expect(out.buildings.map((b) => b.offset.x)).toEqual([-8, 24]);
    expect(report.moved).toEqual([0, 1]);
    // And once they have moved they are 48 elmos wide on 40 elmos of gap.
    expect(report.overlapping).toEqual([0, 1]);
    expect(report.checked).toBe(true);
  });

  it("moves nothing when the substitute stands on the same ground", () => {
    const mex: BaseBlueprint = {
      ...layout,
      buildings: [{ def: "armmex", offset: { x: 16, z: 0 }, facing: 0 }],
    };
    const { layout: out, report } = substituteBlueprint(
      mex,
      { armmex: "cormex" },
      footprintOf,
    );
    expect(out.buildings[0].offset).toEqual({ x: 16, z: 0 });
    expect(report.moved).toEqual([]);
    expect(report.overlapping).toEqual([]);
  });

  it("checks nothing, and says it checked nothing, without the game's footprints", () => {
    const { layout: out, report } = substituteBlueprint(layout, plan);
    expect(out.buildings.map((b) => b.offset.x)).toEqual([-16, 16]);
    expect(report.checked).toBe(false);
    expect(report.moved).toEqual([]);
    expect(report.overlapping).toEqual([]);
  });

  it("names the defs it was given no substitute for", () => {
    const mixed: BaseBlueprint = {
      ...layout,
      buildings: [
        ...layout.buildings,
        { def: "armllt", offset: { x: 96, z: 0 }, facing: 0 },
      ],
    };
    const { layout: out, report } = substituteBlueprint(
      mixed,
      plan,
      footprintOf,
    );
    expect(report.kept).toEqual(["armllt"]);
    expect(out.buildings[2]).toEqual(mixed.buildings[2]);
  });

  it("keeps the name a building was first drawn as through a second swap", () => {
    const once = substituteBlueprint(layout, plan, footprintOf).layout;
    const twice = substituteBlueprint(
      once,
      { corsolar: "legsolar" },
      footprintOf,
    ).layout;
    expect(twice.buildings[0].def).toBe("legsolar");
    expect(twice.buildings[0].originalName).toBe("armsolar");
  });

  it("stops calling a building a substitute once it is put back", () => {
    const once = substituteBlueprint(layout, plan, footprintOf).layout;
    const back = substituteBlueprint(
      once,
      { corsolar: "armsolar" },
      footprintOf,
    ).layout;
    expect(back.buildings[0]).not.toHaveProperty("originalName");
    expect(substitutedCount(back)).toBe(0);
  });
});

describe("revertSubstitution", () => {
  it("puts every substituted building back under the name it was drawn as", () => {
    const swapped = substituteBlueprint(
      layout,
      { armsolar: "corsolar" },
      footprintOf,
    ).layout;
    const { layout: out, report } = revertSubstitution(swapped, footprintOf);
    expect(out.buildings.map((b) => b.def)).toEqual(["armsolar", "armsolar"]);
    expect(out.buildings.every((b) => b.originalName === undefined)).toBe(true);
    expect(report.substituted).toHaveLength(2);
    // The grid is what it is: a building put back on a smaller footprint lands
    // on the nearest squares that fit rather than where it began.
    expect(report.moved).toEqual([0, 1]);
  });

  it("has nothing to put back in a layout nobody has converted", () => {
    const { layout: out, report } = revertSubstitution(layout, footprintOf);
    expect(out.buildings).toEqual(layout.buildings);
    expect(report.substituted).toEqual([]);
  });
});

describe("substitutionNotes", () => {
  const notes = (
    l: BaseBlueprint,
    plan: Record<string, string>,
    f?: typeof footprintOf,
  ) => substitutionNotes(substituteBlueprint(l, plan, f).report);

  it("warns that buildings will move and that they will want the same ground", () => {
    const said = notes(layout, { armsolar: "corsolar" }, footprintOf);
    expect(said[0]).toEqual({
      tone: "warn",
      text: expect.stringContaining("ground another building wants"),
    });
    expect(
      said.some((n) => n.text.includes("will not stand where they do")),
    ).toBe(true);
    expect(said.every((n) => n.tone === "warn")).toBe(true);
  });

  it("says which buildings it found nothing for", () => {
    const mixed: BaseBlueprint = {
      ...layout,
      buildings: [
        { def: "armmex", offset: { x: 16, z: 0 }, facing: 0 },
        { def: "armllt", offset: { x: 96, z: 0 }, facing: 0 },
      ],
    };
    const said = notes(mixed, { armmex: "cormex" }, footprintOf);
    expect(said).toEqual([
      { tone: "note", text: expect.stringContaining("armllt") },
    ]);
  });

  it("says it has not checked when the game's units have not been read", () => {
    const said = notes(layout, { armsolar: "corsolar" });
    expect(said.some((n) => n.text.includes("has not read"))).toBe(true);
  });

  it("says nothing about a swap with nothing wrong with it", () => {
    const mex: BaseBlueprint = {
      ...layout,
      buildings: [{ def: "armmex", offset: { x: 16, z: 0 }, facing: 0 }],
    };
    expect(notes(mex, { armmex: "cormex" }, footprintOf)).toEqual([]);
  });
});
