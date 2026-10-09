import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanResult } from "./bindings";

// The bindings call `defineCommand` at import. Stand in a recorder so a test can
// read the arguments a command would have sent to Rust.
const sent = vi.hoisted(
  () => [] as Array<{ command: string; args: Record<string, unknown> }>,
);
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: (_plugin: string, command: string) => async (args: object) => {
    sent.push({ command, args: args as Record<string, unknown> });
    return {};
  },
}));

import {
  unitsyncFactionLogos,
  unitsyncGameInfo,
  unitsyncHeightmap,
  unitsyncMapInfo,
  unitsyncMinimap,
  unitsyncSkirmishAis,
  unitsyncUnitBuildpics,
  unitsyncUnitDataset,
  unitsyncUnitModels,
} from "./bindings";
import { forgetScanHints, rememberScanHints } from "./scanHints";

const target = { enginePath: "/engine", dataDir: "/data" };

function scan(): ScanResult {
  return {
    maps: [
      {
        name: "Aetherian Void 1.7",
        fileName: "maps/aetherian_void.smf",
        archives: [{ name: "Aetherian Void 1.7" }],
        info: {},
      },
    ],
    games: [
      {
        name: "Splinter Faction",
        primaryArchive: {
          name: "SplinterFaction_0.1.86.sdz",
          path: "/games/SplinterFaction_0.1.86.sdz",
        },
        dependencyArchives: [],
        info: {},
      },
    ],
    errors: [],
  };
}

beforeEach(() => {
  sent.length = 0;
  forgetScanHints();
  rememberScanHints("/data", "/engine", scan());
});

describe("a cached read carries what the scan knows", () => {
  it("sends a game's archive path with its info read", async () => {
    await unitsyncGameInfo({
      ...target,
      gameArchive: "SplinterFaction_0.1.86.sdz",
    });
    expect(sent).toEqual([
      {
        command: "unitsync_game_info",
        args: {
          ...target,
          gameArchive: "SplinterFaction_0.1.86.sdz",
          archivePath: "/games/SplinterFaction_0.1.86.sdz",
        },
      },
    ]);
  });

  it("sends a game's archive path with its unit dataset read", async () => {
    await unitsyncUnitDataset({
      ...target,
      gameArchive: "SplinterFaction_0.1.86.sdz",
    });
    expect(sent[0]?.args.archivePath).toBe("/games/SplinterFaction_0.1.86.sdz");
  });

  it("sends a name keyed map's file name with its options read", async () => {
    await unitsyncMapInfo({ ...target, mapName: "Aetherian Void 1.7" });
    expect(sent[0]?.args).toMatchObject({
      mapName: "Aetherian Void 1.7",
      fileName: "maps/aetherian_void.smf",
    });
    expect(sent[0]?.args.archivePath).toBeUndefined();
  });

  it("sends a name keyed map's file name with its minimap and heightmap reads", async () => {
    await unitsyncMinimap({ ...target, mapName: "Aetherian Void 1.7", mip: 0 });
    await unitsyncHeightmap({ ...target, mapName: "Aetherian Void 1.7" });
    expect(sent.map((s) => s.command)).toEqual([
      "unitsync_minimap",
      "unitsync_heightmap",
    ]);
    for (const call of sent) {
      expect(call.args.fileName).toBe("maps/aetherian_void.smf");
      expect(call.args.archivePath).toBeUndefined();
    }
    expect(sent[0]?.args.mip).toBe(0);
  });

  it("sends nothing extra for a map the scan did not list", async () => {
    await unitsyncMinimap({ ...target, mapName: "Not Installed 1.0" });
    expect(sent[0]?.args.fileName).toBeUndefined();
  });

  it("sends the game's archive path with a skirmish AI list for that game", async () => {
    await unitsyncSkirmishAis({
      ...target,
      gameArchive: "SplinterFaction_0.1.86.sdz",
    });
    expect(sent[0]?.args.archivePath).toBe("/games/SplinterFaction_0.1.86.sdz");
  });

  it("sends a game's archive path with its build icon, logo and model reads", async () => {
    const game = { ...target, gameArchive: "SplinterFaction_0.1.86.sdz" };
    await unitsyncUnitBuildpics({ ...game, units: ["armcom"] });
    await unitsyncFactionLogos({ ...game, sides: ["Arm"] });
    await unitsyncUnitModels({ ...game, objects: ["armcom"] });
    expect(sent.map((s) => s.command)).toEqual([
      "unitsync_unit_buildpics",
      "unitsync_faction_logos",
      "unitsync_unit_models",
    ]);
    for (const call of sent) {
      expect(call.args.archivePath).toBe("/games/SplinterFaction_0.1.86.sdz");
    }
  });

  it("sends nothing extra for a game the scan did not place", async () => {
    await unitsyncGameInfo({ ...target, gameArchive: "unknown.sdz" });
    expect(sent[0]?.args.archivePath).toBeUndefined();
  });

  it("sends nothing extra before any scan has finished", async () => {
    forgetScanHints();
    await unitsyncGameInfo({
      ...target,
      gameArchive: "SplinterFaction_0.1.86.sdz",
    });
    expect(sent[0]?.args.archivePath).toBeUndefined();
  });

  it("keeps a path the caller gave rather than replacing it", async () => {
    await unitsyncGameInfo({
      ...target,
      gameArchive: "SplinterFaction_0.1.86.sdz",
      archivePath: "/elsewhere/game.sdz",
    });
    expect(sent[0]?.args.archivePath).toBe("/elsewhere/game.sdz");
  });
});
