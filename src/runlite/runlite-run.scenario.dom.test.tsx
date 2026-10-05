// @vitest-environment happy-dom
/**
 * A scenario location on a Warpath run across a hand-made map (issue #3515),
 * driven through the encounter hook.
 *
 * The map is the sample in `docs/examples/handmade-map/`, read by the real
 * reader, and the run is generated on it. The engine, the disk and the replay
 * reader are stubbed. What is pinned here is which launch the hook makes, which
 * signal it takes the result from, and what the run looks like afterwards.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detectBattleResult, engineLaunch, launchScenario, unitData } =
  vi.hoisted(() => ({
    detectBattleResult: vi.fn(),
    engineLaunch: vi.fn(),
    launchScenario: vi.fn(),
    unitData: { status: "ready" as "ready" | "loading" },
  }));

const GAMES = [
  {
    name: "Test Game 2.0",
    info: { shortname: "TG", version: "2.0" },
    primaryArchive: { name: "tg.sdz" },
  },
];

vi.mock("../scenario/launch", () => ({ launchScenario }));
vi.mock("../scenario/bindings", () => ({
  scenarioMediaWrite: vi.fn(async () => ({})),
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
      maps: [{ name: "Comet Catcher Redux" }, { name: "Small" }],
    },
    error: null,
    loading: false,
    run: vi.fn(),
  }),
  useUnitsyncUnitDataset: () => ({
    dataset: unitData.status === "ready" ? { units: [] } : null,
    status: unitData.status,
    reload: vi.fn(),
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
  toBattleConfig: vi.fn(() => ({ myPlayerName: "You" })),
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

import { decodePng } from "../conquest/handmade/png.testhelper";
import { readHandmadeMap } from "../conquest/handmade/read";
import type { GalaxyDoc } from "../conquest/model";
import { handmadeRunSource } from "./handmadeMap";
import { generateMapRun, runNodeScenario } from "./mapRun";
import type { RogueliteRun } from "./model";
import { useRunEncounter } from "./runlite-run";

// Tests run from the repo root. `import.meta.url` is not a file URL here.
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

const map = sampleMap();
const source = (() => {
  const found = handmadeRunSource(map);
  if (!found) throw new Error("the sample has no Warpath markings");
  return found;
})();

/** A run on the sample that has walked to Eastcliff, one step short of
 * Ironcoast, and is already settled on its game. */
function runAtEastcliff(): RogueliteRun {
  const run = generateMapRun({
    seed: 42,
    length: "standard",
    difficulty: 2,
    game: { shortname: "TG", pinnedName: "Test Game 2.0" },
    factionId: "player",
    skin: "theatre",
    maps: [{ name: "Small", size: 64 }],
    now: "2026-10-05T00:00:00.000Z",
    ...source,
  });
  return {
    ...run,
    // A start unit is what makes a run wait for unit data before a skirmish.
    startUnit: "armcom",
    progress: {
      ...run.progress,
      currentNodeId: "eastcliff",
      visited: ["westhaven", "midvale", "eastcliff"],
    },
  };
}

const played = (exitCode: number | null = 0) => ({
  ok: true,
  route: "mutator",
  reason: "",
  dir: "/data/games/coilbox-mission-test.sdd",
  mission: "missions/siege/mission.lua",
  gameType: "Coilbox Mission Test",
  config: { myPlayerName: "Commander" },
  exitCode,
  warnings: [],
});

function mount(withScenario = true) {
  const run = runAtEastcliff();
  const node = run.nodes.find((n) => n.location === "ironcoast");
  if (!node) throw new Error("the run does not cross Ironcoast");
  const onResolved = vi.fn(async (_next: RogueliteRun) => {});
  const scenario = withScenario ? runNodeScenario(map, node) : undefined;
  const hook = renderHook(() =>
    useRunEncounter(run, node, onResolved, "run-1", scenario),
  );
  return { ...hook, run, node, onResolved };
}

beforeEach(() => {
  for (const mock of [detectBattleResult, engineLaunch, launchScenario]) {
    mock.mockClear();
  }
  unitData.status = "ready";
  launchScenario.mockResolvedValue(played());
  engineLaunch.mockResolvedValue({ exitCode: 0 });
  detectBattleResult.mockResolvedValue({ outcome: "victory", replay: null });
});

afterEach(cleanup);

describe("a fight at a scenario location on a Warpath run", () => {
  it("launches the scenario through the campaign's launch, on the run's game", async () => {
    const { result } = mount();
    expect(result.current.canStart).toBe(true);
    await act(() => result.current.start());
    expect(launchScenario).toHaveBeenCalledTimes(1);
    const input = launchScenario.mock.calls[0][0];
    expect(input.reader).toBe("player");
    expect(input.scenario.id).toBe("siege");
    expect(input.scenario.setup.gameName).toBe("Test Game 2.0");
    // It plays as its author set it up, with none of the run's unit limit.
    expect(input.disabledUnits).toBeUndefined();
    expect(engineLaunch).not.toHaveBeenCalled();
  });

  it("clears the node when the replay says the player won", async () => {
    const { result, run, node, onResolved } = mount();
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("victory"));
    expect(detectBattleResult.mock.calls[0][0].playerName).toBe("Commander");
    expect(onResolved).toHaveBeenCalledTimes(1);
    const next = onResolved.mock.calls[0][0];
    expect(next.progress.visited).toContain(node.id);
    expect(next.progress.currentNodeId).toBe(node.id);
    expect(next.progress.hull).toBe(run.progress.hull);
    expect(next.progress.salvage).toBeGreaterThan(run.progress.salvage);
    expect(next.history.at(-1)).toMatchObject({ outcome: "victory" });
  });

  it("counts a defeat as a lost battle", async () => {
    detectBattleResult.mockResolvedValue({ outcome: "defeat", replay: null });
    const { result, run, onResolved } = mount();
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("defeat"));
    const next = onResolved.mock.calls[0][0];
    expect(next.progress.hull).toBeLessThan(run.progress.hull);
    expect(next.history.at(-1)).toMatchObject({ outcome: "defeat" });
  });

  it("asks the player when the replay does not say who won", async () => {
    detectBattleResult.mockResolvedValue({
      outcome: "ambiguous",
      replay: null,
    });
    const { result, onResolved } = mount();
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("result"));
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("does not wait for the unit data it does not use", () => {
    unitData.status = "loading";
    expect(mount().result.current.canStart).toBe(true);
    cleanup();
    expect(mount(false).result.current.canStart).toBe(false);
  });

  it("fights the node's own skirmish when the map cannot give the scenario", async () => {
    const { result, node } = mount(false);
    expect(node.scenario).toBe("ironcoast-siege.json");
    expect(result.current.snapshot()?.mapName).toBe("Comet Catcher Redux");
    await act(() => result.current.start());
    expect(launchScenario).not.toHaveBeenCalled();
    expect(engineLaunch).toHaveBeenCalledTimes(1);
  });
});
