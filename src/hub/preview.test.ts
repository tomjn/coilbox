import { describe, expect, it } from "vitest";
import type { Container, ContainerKind } from "@/container/container";
import { readPreview } from "./preview";

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
