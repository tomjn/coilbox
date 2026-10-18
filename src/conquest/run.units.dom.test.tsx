// @vitest-environment happy-dom
/**
 * A conquest that carries units from the unit builder (issue #4518), driven
 * through the conquest battle hook.
 *
 * The map is the sample in `docs/examples/handmade-map/`. The engine, the disk,
 * the mutator and the replay reader are stubbed. What is pinned here is that
 * every battle launches through the units mutator, written over the game the
 * conquest resolved, and that a conquest without units launches as before.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { composeUnits, detectBattleResult, engineLaunch, launchScenario } =
  vi.hoisted(() => ({
    composeUnits: vi.fn(),
    detectBattleResult: vi.fn(),
    engineLaunch: vi.fn(),
    launchScenario: vi.fn(),
  }));

const GAMES = [
  {
    name: "SplinterFaction 2.0",
    info: { shortname: "SF", version: "2.0" },
    primaryArchive: { name: "tg.sdz" },
  },
];

vi.mock("../campaign/units", () => ({ composeUnits }));
vi.mock("../scenario/launch", () => ({ launchScenario }));
vi.mock("../scenario/bindings", () => ({
  scenarioMediaWrite: vi.fn(async () => ({})),
}));
vi.mock("./conquests", () => ({
  useConquestState: () => ({ saveFor: vi.fn(async () => {}) }),
}));
vi.mock("../content/bindings", () => ({
  contentListReplays: vi.fn(async () => ({ replays: [] })),
}));
vi.mock("../content/branding", () => ({ useBrandingEntry: () => undefined }));
vi.mock("../content/config", () => ({
  primeScan: vi.fn(async () => ({ games: GAMES })),
  useUnitsyncScan: () => ({
    data: {
      games: GAMES,
      maps: [{ name: "AcidicQuarry 5.17" }, { name: "MapA" }],
    },
    error: null,
    loading: false,
    run: vi.fn(),
  }),
}));
vi.mock("../content/replayUserState", () => ({
  useReplayUserState: () => ({ setProvenance: vi.fn() }),
}));
vi.mock("../profile/profile", () => ({ getProfile: () => ({}) }));
vi.mock("../play/config", () => ({
  applyRestrictions: (config: unknown) => config,
  gameOptionSchema: vi.fn(async () => []),
  mapOptionSchema: vi.fn(async () => []),
  toBattleConfig: vi.fn((draft: { gameType: string }) => ({
    myPlayerName: "You",
    gameType: draft.gameType,
  })),
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      dataDir: "/data",
      executable: "/engine/spring",
    },
    loading: false,
  }),
  useSkirmishAis: () => ({
    ais: [{ kind: "native", shortName: "NullAI", name: "NullAI" }],
  }),
}));
vi.mock("../play/detect", async (original) => ({
  ...(await original<typeof import("../play/detect")>()),
  detectBattleResult,
}));
vi.mock("../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch: engineLaunch }),
}));

import type { CampaignUnit } from "../campaign/model";
import { newHandmadeConquest } from "./handmade/conquest";
import { decodePng } from "./handmade/png.testhelper";
import { readHandmadeMap } from "./handmade/read";
import type { ConquestState, GalaxyDoc } from "./model";
import { useConquestBattleRun } from "./run";

const SAMPLE = `${resolve("docs/examples/handmade-map")}/`;
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));

function sampleMap(): GalaxyDoc {
  const result = readHandmadeMap({
    manifest: readFileSync(`${SAMPLE}map.json`, "utf8"),
    provinces,
    picture: { width: provinces.width, height: provinces.height },
    urlFor: (name) => `asset://map/${name}`,
    scenarios: {
      "ironcoast-siege.json": readFileSync(
        `${SAMPLE}ironcoast-siege.json`,
        "utf8",
      ),
    },
  });
  if (!result.ok) throw new Error("the sample map did not read");
  return result.doc;
}

const galaxy = sampleMap();
const ironcoast = galaxy.nodes.find((n) => n.id === "ironcoast");
if (!ironcoast) throw new Error("the sample has no Ironcoast");

const skyfort: CampaignUnit = {
  unitName: "skyfort",
  projectId: "p-skyfort",
  name: "Skyfort",
  builtBy: ["armap"],
  copiedAt: "2026-10-18T00:00:00.000Z",
};

function state(units?: CampaignUnit[], scenarioWon = false): ConquestState {
  const fresh = newHandmadeConquest(
    galaxy,
    { seed: 7, fogOfWar: false, threatLevel: 0, playerFactionId: "west" },
    [{ name: "MapA", width: 8, height: 8 }],
    "2026-10-05T00:00:00.000Z",
  );
  return {
    ...fresh,
    pinnedGame: "SplinterFaction 2.0",
    ...(units ? { units } : {}),
    handmade: fresh.handmade && {
      ...fresh.handmade,
      ...(scenarioWon ? { scenariosWon: ["ironcoast"] } : {}),
    },
  };
}

function mount(s: ConquestState) {
  return renderHook(() => useConquestBattleRun(galaxy, s, ironcoast, "attack"));
}

beforeEach(() => {
  for (const mock of [
    composeUnits,
    detectBattleResult,
    engineLaunch,
    launchScenario,
  ]) {
    mock.mockReset();
  }
  composeUnits.mockResolvedValue({
    name: "Coilbox conquest units",
    leftOut: [
      "armap is not in SplinterFaction 2.0, so it does not build skyfort.",
    ],
  });
  engineLaunch.mockResolvedValue({ exitCode: null });
  launchScenario.mockResolvedValue({
    ok: true,
    config: { myPlayerName: "Commander" },
    exitCode: null,
  });
});

afterEach(cleanup);

describe("a conquest carrying units from the unit builder", () => {
  it("launches a skirmish as the units mutator over the game the conquest resolved", async () => {
    const { result } = mount(state([skyfort], true));
    await act(() => result.current.start());

    expect(composeUnits).toHaveBeenCalledTimes(1);
    const [owner, target, base] = composeUnits.mock.calls[0];
    expect(owner).toEqual({
      scope: "conquest",
      id: galaxy.id,
      units: [skyfort],
    });
    expect(target.dataDir).toBe("/data");
    expect(base).toEqual({ name: "SplinterFaction 2.0", archive: "tg.sdz" });
    expect(engineLaunch).toHaveBeenCalledTimes(1);
    expect(engineLaunch.mock.calls[0][1].config.gameType).toBe(
      "Coilbox conquest units",
    );
    expect(result.current.leftOut).toEqual([
      "armap is not in SplinterFaction 2.0, so it does not build skyfort.",
    ]);
  });

  it("plays a scenario location on top of the units mutator", async () => {
    const { result } = mount(state([skyfort]));
    expect(result.current.scenario).toBeDefined();
    await act(() => result.current.start());
    expect(launchScenario).toHaveBeenCalledTimes(1);
    expect(launchScenario.mock.calls[0][0].unitsGame).toBe(
      "Coilbox conquest units",
    );
  });

  it("shows why and starts nothing when the mutator cannot be written", async () => {
    composeUnits.mockRejectedValue(
      new Error("This conquest's copy of Skyfort is missing."),
    );
    const { result } = mount(state([skyfort], true));
    await act(() => result.current.start());
    expect(engineLaunch).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      "This conquest's copy of Skyfort is missing.",
    );
  });

  it("launches the game itself when the conquest carries no units", async () => {
    const { result } = mount(state(undefined, true));
    await act(() => result.current.start());
    expect(composeUnits).not.toHaveBeenCalled();
    expect(engineLaunch.mock.calls[0][1].config.gameType).toBe(
      "SplinterFaction 2.0",
    );
    expect(result.current.leftOut).toEqual([]);
  });
});
