import { describe, expect, it } from "vitest";
import type { Container, ContainerKind } from "@/container/container";
import { type BlueprintShape, blueprintSheet, readPreview } from "./preview";

function container(kind: ContainerKind, payload: unknown): Container {
  return {
    format: "coilbox",
    container: 1,
    kind,
    kindVersion: 1,
    payload,
  };
}

/** Settings a real conquest challenge carries, which is the least the
 * generator will accept. */
const CONQUEST = {
  seed: 12345,
  title: "A shared galaxy",
  game: { shortname: "sf" },
  nodeCount: 20,
  factionCount: 2,
  layout: "spiral",
};

describe("readPreview", () => {
  it("groups a preset's participants into ally teams", () => {
    const preview = readPreview(
      container("preset", {
        gameName: "Splinter Faction 1.0",
        mapName: "Somewhere",
        participants: [
          {
            id: "p0",
            kind: "you",
            name: "tomjn",
            side: "ARM",
            color: [1, 0, 0],
            allyTeam: 0,
          },
          {
            id: "p1",
            kind: "ai",
            ai: { shortName: "BARb", name: "BARbarian" },
            side: "__random__",
            color: [0, 0.5, 1],
            allyTeam: 1,
          },
          {
            id: "p2",
            kind: "ai",
            ai: { shortName: "BARb" },
            side: "",
            color: [0, 1, 0],
            allyTeam: 1,
          },
        ],
      }),
    );

    expect(preview).toEqual({
      kind: "preset",
      playing: 3,
      teams: [
        {
          allyTeam: 0,
          members: [
            { id: "p0", label: "tomjn", side: "ARM", color: "rgb(255 0 0)" },
          ],
        },
        {
          allyTeam: 1,
          members: [
            {
              id: "p1",
              label: "BARbarian",
              side: "Random",
              color: "rgb(0 128 255)",
            },
            { id: "p2", label: "BARb", side: null, color: "rgb(0 255 0)" },
          ],
        },
      ],
    });
  });

  it("names an AI-less slot rather than leaving it blank", () => {
    const preview = readPreview(
      container("preset", {
        participants: [{ kind: "ai", allyTeam: 0, color: [0, 0, 0] }],
      }),
    );
    // No participant id in the payload, so the row is identified by position.
    expect(preview).toMatchObject({
      teams: [{ members: [{ id: "slot-0", label: "Open slot" }] }],
    });
  });

  it("has nothing to show for a preset where nobody is playing", () => {
    const preview = readPreview(
      container("preset", {
        participants: [{ kind: "you", spectator: true, allyTeam: 0 }],
      }),
    );
    expect(preview).toBeNull();
  });

  it("lists what a setup pack installs", () => {
    const preview = readPreview(
      container("setup-pack", {
        game: { name: "Splinter Faction 1.0" },
        engineVersion: "105.1.1",
        maps: ["Comet Catcher Redux", "Supreme Isthmus"],
      }),
    );
    expect(preview).toEqual({
      kind: "setup-pack",
      stats: [
        { label: "Game", value: "Splinter Faction 1.0" },
        { label: "Engine", value: "105.1.1" },
        {
          label: "Maps",
          value: "Comet Catcher Redux, Supreme Isthmus",
        },
      ],
    });
  });

  it("reads a pack that pins no engine as taking whatever you have", () => {
    const preview = readPreview(
      container("setup-pack", {
        game: { name: "BAR" },
        engineVersion: ".spring",
        maps: ["Comet Catcher Redux"],
      }),
    );
    expect(preview).toMatchObject({
      stats: [
        { label: "Game", value: "BAR" },
        { label: "Engine", value: "Whatever you have" },
        { label: "Map", value: "Comet Catcher Redux" },
      ],
    });
  });

  it("has nothing to show for a pack that names nothing", () => {
    expect(readPreview(container("setup-pack", { maps: [] }))).toBeNull();
  });

  it("lists every game a collection pack names, not just one", () => {
    const preview = readPreview(
      container("setup-pack", {
        games: [{ name: "Splinter Faction 1.0" }, { name: "BAR" }],
        maps: ["Comet Catcher Redux"],
      }),
    );
    expect(preview).toMatchObject({
      stats: [
        { label: "Games", value: "Splinter Faction 1.0, BAR" },
        { label: "Engine", value: "Whatever you have" },
        { label: "Map", value: "Comet Catcher Redux" },
      ],
    });
  });

  it("previews a pack that names only games", () => {
    const preview = readPreview(
      container("setup-pack", {
        games: [{ name: "BAR" }],
      }),
    );
    expect(preview).toEqual({
      kind: "setup-pack",
      stats: [
        { label: "Game", value: "BAR" },
        { label: "Engine", value: "Whatever you have" },
        { label: "Maps", value: "None" },
      ],
    });
  });

  it("previews a pack that names only maps", () => {
    const preview = readPreview(
      container("setup-pack", {
        maps: ["Comet Catcher Redux", "Supreme Isthmus"],
      }),
    );
    expect(preview).toEqual({
      kind: "setup-pack",
      stats: [
        { label: "Games", value: "None" },
        { label: "Engine", value: "Whatever you have" },
        {
          label: "Maps",
          value: "Comet Catcher Redux, Supreme Isthmus",
        },
      ],
    });
  });

  it("rebuilds a conquest challenge's galaxy from its seed", () => {
    const preview = readPreview(
      container("challenge", { mode: "conquest", settings: CONQUEST }),
    );
    expect(preview).toMatchObject({
      kind: "challenge",
      stats: [
        { label: "Systems", value: "20" },
        { label: "Enemies", value: "2" },
        { label: "Layout", value: "spiral" },
      ],
    });
    if (preview?.kind !== "challenge" || !preview.galaxy) {
      throw new Error("expected a galaxy");
    }
    const { systems, lanes, factionColors } = preview.galaxy;
    expect(systems).toHaveLength(20);
    expect(lanes.length).toBeGreaterThan(0);
    // Player plus its enemies, and every system fitted into the unit square.
    expect(factionColors).toHaveLength(3);
    for (const s of systems) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(1);
    }
    expect(systems.some((s) => s.capital)).toBe(true);
    expect(systems.some((s) => s.faction === null)).toBe(true);
  });

  it("draws the same galaxy every time, because the seed decides it", () => {
    const once = readPreview(
      container("challenge", { mode: "conquest", settings: CONQUEST }),
    );
    const again = readPreview(
      container("challenge", { mode: "conquest", settings: CONQUEST }),
    );
    expect(once).toEqual(again);
  });

  it("has nothing to show for conquest settings it cannot read", () => {
    const preview = readPreview(
      container("challenge", {
        mode: "conquest",
        settings: { seed: "not a number", title: "x" },
      }),
    );
    expect(preview).toBeNull();
  });

  it("shows a warpath challenge's numbers and no galaxy", () => {
    const preview = readPreview(
      container("challenge", {
        mode: "warpath",
        settings: {
          seed: 7,
          length: "long",
          difficulty: 3,
          ascension: 2,
          game: { shortname: "sf" },
          factionId: "arm",
        },
      }),
    );
    expect(preview).toEqual({
      kind: "challenge",
      galaxy: null,
      stats: [
        { label: "Length", value: "long" },
        { label: "Difficulty", value: "3" },
        { label: "Ascension", value: "2" },
      ],
    });
  });

  it("leaves ascension off a run that has none", () => {
    const preview = readPreview(
      container("challenge", {
        mode: "warpath",
        settings: { length: "short", difficulty: 1, ascension: 0 },
      }),
    );
    expect(preview).toMatchObject({
      stats: [
        { label: "Length", value: "short" },
        { label: "Difficulty", value: "1" },
      ],
    });
  });

  it("counts what a scenario is made of, wrapped or bare", () => {
    const scenario = {
      objectives: [{}, {}],
      triggers: [{}, {}, {}],
      zones: [{}],
      teams: { p1: {}, p2: {} },
      actors: [],
      dialogue: [{}],
    };
    const expected = {
      kind: "scenario",
      stats: [
        { label: "Objectives", value: "2" },
        { label: "Triggers", value: "3" },
        { label: "Zones", value: "1" },
        { label: "Teams", value: "2" },
        { label: "Dialogue", value: "1" },
      ],
    };
    expect(readPreview(container("scenario", { scenario }))).toEqual(expected);
    expect(readPreview(container("scenario", scenario))).toEqual(expected);
  });

  it("has nothing to show for an empty scenario", () => {
    const preview = readPreview(
      container("scenario", { scenario: { objectives: [], triggers: [] } }),
    );
    expect(preview).toBeNull();
  });

  it("sizes a blueprint's squares by what each building stands on", () => {
    const preview = readPreview(
      container("blueprint", {
        name: "A wall of solars",
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armlab", offset: { x: 64, z: 0 }, facing: 0 },
        ],
        footprints: { armsolar: { x: 1, z: 1 }, armlab: { x: 3, z: 2 } },
      }),
    );
    expect(preview?.kind).toBe("blueprint");
    if (preview?.kind !== "blueprint") return;
    const [solar, lab] = preview.layout.squares;
    // A gap is taken off each side, so a one-square building is 1 - 0.12 * 2.
    expect(solar.width).toBeCloseTo(0.76);
    expect(solar.height).toBeCloseTo(0.76);
    expect(lab.width).toBeCloseTo(2.76);
    expect(lab.height).toBeCloseTo(1.76);
  });

  it("turns a blueprint's building on its side when it faces east or west", () => {
    const preview = readPreview(
      container("blueprint", {
        name: "Turned",
        buildings: [{ def: "armlab", offset: { x: 0, z: 0 }, facing: 1 }],
        footprints: { armlab: { x: 3, z: 2 } },
      }),
    );
    if (preview?.kind !== "blueprint") throw new Error("no blueprint preview");
    expect(preview.layout.width).toBeCloseTo(2);
    expect(preview.layout.height).toBeCloseTo(3);
  });

  it("fits a blueprint drawn around its origin inside its own box", () => {
    const preview = readPreview(
      container("blueprint", {
        name: "Around the origin",
        buildings: [
          { def: "armsolar", offset: { x: -64, z: -32 }, facing: 0 },
          { def: "armsolar", offset: { x: 64, z: 96 }, facing: 0 },
          { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
        ],
        footprints: { armsolar: { x: 1, z: 1 }, armlab: { x: 3, z: 2 } },
      }),
    );
    if (preview?.kind !== "blueprint") throw new Error("no blueprint preview");
    const { width, height, squares } = preview.layout;
    expect(squares).toHaveLength(3);
    for (const square of squares) {
      expect(square.x).toBeGreaterThanOrEqual(0);
      expect(square.y).toBeGreaterThanOrEqual(0);
      expect(square.x + square.width).toBeLessThanOrEqual(width);
      expect(square.y + square.height).toBeLessThanOrEqual(height);
    }
  });

  it("stands a blueprint's unknown def on one square rather than dropping it", () => {
    const preview = readPreview(
      container("blueprint", {
        name: "Half measured",
        ordered: true,
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "whatisthis", offset: { x: 32, z: 0 }, facing: 0 },
        ],
        footprints: { armsolar: { x: 1, z: 1 } },
      }),
    );
    if (preview?.kind !== "blueprint") throw new Error("no blueprint preview");
    expect(preview.layout.ordered).toBe(true);
    expect(preview.layout.squares.map((s) => s.def)).toEqual([
      "armsolar",
      "whatisthis",
    ]);
    const unknown = preview.layout.squares[1];
    expect(unknown.width).toBeCloseTo(0.76);
    expect(unknown.height).toBeCloseTo(0.76);
  });

  it("has nothing to draw for a blueprint with no buildings in it", () => {
    expect(
      readPreview(container("blueprint", { name: "Empty", buildings: [] })),
    ).toBeNull();
    expect(
      readPreview(container("blueprint", { name: "Damaged", buildings: 5 })),
    ).toBeNull();
  });

  it("shows nothing for a kind the hub does not carry", () => {
    expect(
      readPreview(container("campaign", { type: "ta", missions: [] })),
    ).toBeNull();
  });

  it("shows nothing for a payload that is not an object", () => {
    expect(readPreview(container("preset", "nonsense"))).toBeNull();
    expect(readPreview(container("preset", null))).toBeNull();
  });

  it("shows nothing rather than throwing on a payload of the wrong shape", () => {
    expect(
      readPreview(container("preset", { participants: "not a list" })),
    ).toBeNull();
    expect(
      readPreview(container("challenge", { mode: "conquest", settings: 5 })),
    ).toBeNull();
  });
});

describe("blueprintSheet", () => {
  /** A layout of one building, as many build squares across as asked for. */
  const shape = (width: number, height: number): BlueprintShape => ({
    width,
    height,
    ordered: false,
    squares: [{ def: "armlab", sized: true, x: 0, y: 0, width, height }],
  });

  /** A library card's picture, which is the smallest place a layout is drawn at
   *  a size somebody reads it at. */
  const card = { width: 232, height: 96 };

  it("covers the whole box it is drawn in, at one scale on both axes", () => {
    const sheet = blueprintSheet(shape(21, 18), card);
    expect(sheet.width * sheet.scale).toBeCloseTo(card.width);
    expect(sheet.height * sheet.scale).toBeCloseTo(card.height);
  });

  it("centres the layout on the sheet", () => {
    const sheet = blueprintSheet(shape(21, 18), card);
    expect(sheet.left).toBeCloseTo(-(sheet.width - 21) / 2);
    expect(sheet.top).toBeCloseTo(-(sheet.height - 18) / 2);
  });

  it("keeps a build square of clear ground on every side", () => {
    for (const [across, down] of [
      [21, 18],
      [3, 3],
      [60, 8],
    ]) {
      const sheet = blueprintSheet(shape(across, down), card);
      expect(sheet.left).toBeLessThanOrEqual(-1);
      expect(sheet.top).toBeLessThanOrEqual(-1);
      expect(sheet.left + sheet.width).toBeGreaterThanOrEqual(across + 1);
      expect(sheet.top + sheet.height).toBeGreaterThanOrEqual(down + 1);
    }
  });

  it("rules every build square, so every footprint edge lands on a rule", () => {
    // The size "Opening solars" is drawn at on a card, where a grid of every
    // second square left its five square solar collectors straddling the rules.
    const sheet = blueprintSheet(shape(21, 18), card);
    const consecutive = sheet.verticals.map((_, i) => sheet.verticals[0] + i);
    expect(sheet.verticals).toEqual(consecutive);
    for (const edge of [0, 5, 16, 21]) expect(sheet.verticals).toContain(edge);
    for (const edge of [0, 5, 13, 18])
      expect(sheet.horizontals).toContain(edge);
  });

  it("rules from the layout's own origin, wherever the sheet starts", () => {
    const sheet = blueprintSheet(shape(21, 18), card);
    for (const at of [...sheet.verticals, ...sheet.horizontals]) {
      expect(Number.isInteger(at)).toBe(true);
    }
    expect(sheet.verticals[0]).toBeGreaterThanOrEqual(sheet.left);
    expect(sheet.verticals[0] - 1).toBeLessThan(sheet.left);
  });

  it("stops ruling a base too big to draw a build square of", () => {
    // Six hundred squares across a card is half a pixel a square, which is fill
    // rather than a grid.
    const sheet = blueprintSheet(shape(600, 400), card);
    expect(sheet.verticals).toEqual([]);
    expect(sheet.horizontals).toEqual([]);
    // The layout is still drawn, and still centred.
    expect(sheet.left).toBeCloseTo(-(sheet.width - 600) / 2);
  });

  it("does not blow a small layout up to fill the box", () => {
    const sheet = blueprintSheet(shape(1, 1), card);
    expect(sheet.scale).toBe(16);
    expect(sheet.width).toBeCloseTo(232 / 16);
  });
});
