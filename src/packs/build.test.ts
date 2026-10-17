import { describe, expect, it, vi } from "vitest";

// `build.ts` reaches `play/presets.ts` for the preset type, which reaches
// `useSetting` from the frame package. Stub it the way `manifest.test.ts` does.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [undefined, () => {}],
}));

import type { StoredBlueprint } from "../blueprint/library";
import type { SkirmishPreset } from "../play/presets";
import { aiGameNameForPack, buildPackManifest } from "./build";

function preset(overrides: Partial<SkirmishPreset> = {}): SkirmishPreset {
  return {
    id: "id-1",
    name: "My preset",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
    participants: [],
    gameName: "Game A",
    mapName: "Map One",
    startPosType: 0,
    modOptionValues: {},
    ...overrides,
  };
}

describe("buildPackManifest", () => {
  it("builds a maps-only pack", () => {
    const built = buildPackManifest({
      title: "Popular water maps",
      gameNames: [],
      mapNames: ["Map One", "Map Two"],
      presets: [],
      blueprints: [],
      installedGames: [],
    });
    expect(built).toEqual({
      title: "Popular water maps",
      maps: ["Map One", "Map Two"],
    });
  });

  it("fills each game's shortname from the installed list", () => {
    const built = buildPackManifest({
      title: "",
      gameNames: ["Game A"],
      mapNames: [],
      presets: [],
      blueprints: [],
      installedGames: [{ name: "Game A", shortname: "ga" }],
    });
    expect(built?.games).toEqual([{ name: "Game A", shortname: "ga" }]);
  });

  it("strips a preset's identity and timestamps", () => {
    const built = buildPackManifest({
      title: "",
      gameNames: [],
      mapNames: ["Map One"],
      presets: [preset()],
      blueprints: [],
      installedGames: [],
    });
    expect(built?.presets?.[0]).not.toHaveProperty("id");
    expect(built?.presets?.[0]).not.toHaveProperty("createdAt");
    expect(built?.presets?.[0]?.name).toBe("My preset");
  });

  it("refuses a pack with no games and no maps", () => {
    expect(
      buildPackManifest({
        title: "Empty",
        gameNames: [],
        mapNames: [],
        presets: [preset()],
        blueprints: [],
        installedGames: [],
      }),
    ).toBeNull();
  });

  it("carries a blueprint's layout and leaves this machine's record behind", () => {
    const record: StoredBlueprint = {
      id: "b1",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      layout: {
        name: "Opening solars",
        buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
        footprints: { armsolar: { x: 4, z: 4 } },
      },
      source: { kind: "file", file: "/Users/me/opening.json", at: "" },
    };
    const built = buildPackManifest({
      title: "",
      gameNames: ["Game A"],
      mapNames: [],
      presets: [],
      blueprints: [record],
      installedGames: [],
    });
    expect(built?.blueprints).toEqual([record.layout]);
  });

  it("refuses a pack of blueprints alone", () => {
    expect(
      buildPackManifest({
        title: "",
        gameNames: [],
        mapNames: [],
        presets: [],
        blueprints: [
          {
            id: "b1",
            createdAt: "",
            updatedAt: "",
            layout: { name: "Wall", buildings: [], footprints: {} },
          },
        ],
        installedGames: [],
      }),
    ).toBeNull();
  });

  it("never pins an engine version", () => {
    const built = buildPackManifest({
      title: "",
      gameNames: ["Game A"],
      mapNames: ["Map One"],
      presets: [],
      blueprints: [],
      installedGames: [{ name: "Game A" }],
    });
    expect(built).not.toHaveProperty("engineVersion");
  });
});

describe("aiGameNameForPack", () => {
  it("uses the game the first bundled preset names", () => {
    const {
      id: _id,
      createdAt: _c,
      lastUsedAt: _l,
      ...bundled
    } = preset({
      gameName: "Game B",
    });
    expect(
      aiGameNameForPack({
        games: [{ name: "Game A" }, { name: "Game B" }],
        presets: [bundled],
      }),
    ).toBe("Game B");
  });

  it("falls back to the pack's first game with no presets", () => {
    expect(aiGameNameForPack({ games: [{ name: "Game A" }] })).toBe("Game A");
  });

  it("has no answer for a maps-only pack", () => {
    expect(aiGameNameForPack({ maps: ["Map One"] })).toBeUndefined();
  });
});
