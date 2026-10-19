// @vitest-environment happy-dom
/**
 * A Warpath run that carries units from the unit builder (issue #4518), driven
 * through the encounter hook.
 *
 * The run is generated on the sample hand-made map. The engine, the disk, the
 * mutator and the replay reader are stubbed. What is pinned here is that a
 * battle launches through the units mutator over the run's game, and that the
 * run's unit limit locks a carried unit until the run unlocks it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { composeUnits, engineLaunch, launchScenario } = vi.hoisted(() => ({
  composeUnits: vi.fn(),
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

/** The game's own build tree: the commander builds a lab that builds a bot. */
const UNITS = [
  { name: "armcom", buildOptions: ["armlab"] },
  { name: "armlab", buildOptions: ["armpw"] },
  { name: "armpw", buildOptions: [] },
];

vi.mock("../campaign/units", () => ({ composeUnits }));
// No game has its compatibility switch on here (issue #4664).
vi.mock("../content/compatSettings", () => ({
  useCompatSettings: () => [{}],
}));
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
      maps: [{ name: "AcidicQuarry 5.17" }, { name: "Small" }],
    },
    error: null,
    loading: false,
    run: vi.fn(),
  }),
  useUnitsyncUnitDataset: () => ({
    dataset: { units: UNITS },
    status: "ready",
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
  toBattleConfig: vi.fn(
    (draft: { gameType: string; disabledUnits?: string[] }) => ({
      myPlayerName: "You",
      gameType: draft.gameType,
      disabledUnits: draft.disabledUnits,
    }),
  ),
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
vi.mock("../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch: engineLaunch }),
}));

import type { CampaignUnit } from "../campaign/model";
import { decodePng } from "../conquest/handmade/png.testhelper";
import { readHandmadeMap } from "../conquest/handmade/read";
import { handmadeRunSource } from "./handmadeMap";
import { generateMapRun, runNodeScenario } from "./mapRun";
import type { RogueliteRun } from "./model";
import { useRunEncounter } from "./runlite-run";

const SAMPLE = `${resolve("docs/examples/handmade-map")}/`;
const provinces = decodePng(readFileSync(`${SAMPLE}provinces.png`));
const map = (() => {
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
})();
const source = (() => {
  const found = handmadeRunSource(map);
  if (!found) throw new Error("the sample has no Warpath markings");
  return found;
})();

const skyfort: CampaignUnit = {
  unitName: "skyfort",
  projectId: "p-skyfort",
  name: "Skyfort",
  builtBy: ["armlab"],
  copiedAt: "2026-10-18T00:00:00.000Z",
};

/** A run one step short of Ironcoast, carrying `units`, with `unlocked`. */
function run(units?: CampaignUnit[], unlocked: string[] = []): RogueliteRun {
  const made = generateMapRun({
    seed: 42,
    length: "standard",
    difficulty: 2,
    game: { shortname: "SF", pinnedName: "SplinterFaction 2.0" },
    factionId: "player",
    skin: "theatre",
    maps: [{ name: "Small", size: 64 }],
    now: "2026-10-05T00:00:00.000Z",
    ...source,
  });
  return {
    ...made,
    startUnit: "armcom",
    progress: {
      ...made.progress,
      currentNodeId: "eastcliff",
      visited: ["westhaven", "midvale", "eastcliff"],
      // A run starts with its start unit unlocked.
      unlockedUnits: ["armcom", ...unlocked],
    },
    ...(units ? { units } : {}),
  };
}

function mount(r: RogueliteRun, withScenario = false) {
  const node = r.nodes.find((n) => n.location === "ironcoast");
  if (!node) throw new Error("the run does not cross Ironcoast");
  const scenario = withScenario ? runNodeScenario(map, node) : undefined;
  return renderHook(() =>
    useRunEncounter(
      r,
      node,
      vi.fn(async () => {}),
      "run-1",
      scenario,
    ),
  );
}

function disabled(
  limit: ReturnType<typeof mount>["result"]["current"]["limit"],
) {
  if (limit.kind !== "ready" || limit.limit.kind !== "limited") {
    throw new Error(`no limit: ${JSON.stringify(limit)}`);
  }
  return [...limit.limit.disabled].sort();
}

beforeEach(() => {
  for (const mock of [composeUnits, engineLaunch, launchScenario]) {
    mock.mockReset();
  }
  composeUnits.mockResolvedValue({ name: "Coilbox run units", leftOut: [] });
  engineLaunch.mockResolvedValue({ exitCode: null });
  launchScenario.mockResolvedValue({
    ok: true,
    config: { myPlayerName: "Commander" },
    exitCode: null,
  });
});

afterEach(cleanup);

describe("a Warpath run carrying units from the unit builder", () => {
  it("launches its battle as the units mutator over the run's game", async () => {
    const { result } = mount(run([skyfort]));
    expect(result.current.canStart).toBe(true);
    await act(() => result.current.start());

    const [owner, , base] = composeUnits.mock.calls[0];
    expect(owner).toEqual({ scope: "warpath", id: "run-1", units: [skyfort] });
    expect(base).toEqual({ name: "SplinterFaction 2.0", archive: "tg.sdz" });
    expect(engineLaunch.mock.calls[0][1].config.gameType).toBe(
      "Coilbox run units",
    );
  });

  it("plays a scenario node on top of the units mutator", async () => {
    const { result } = mount(run([skyfort]), true);
    await act(() => result.current.start());
    expect(launchScenario.mock.calls[0][0].unitsGame).toBe("Coilbox run units");
  });

  it("locks a carried unit its builder builds until the run unlocks it", async () => {
    const locked = mount(run([skyfort]));
    expect(disabled(locked.result.current.limit)).toEqual([
      "armlab",
      "armpw",
      "skyfort",
    ]);
    await act(() => locked.result.current.start());
    expect(engineLaunch.mock.calls[0][1].config.disabledUnits).toContain(
      "skyfort",
    );
    cleanup();

    const unlocked = mount(run([skyfort], ["armlab", "skyfort"]));
    expect(disabled(unlocked.result.current.limit)).toEqual(["armpw"]);
  });

  it("launches the game itself, with only the game's units limited, when it carries none", async () => {
    const { result } = mount(run());
    expect(disabled(result.current.limit)).toEqual(["armlab", "armpw"]);
    await act(() => result.current.start());
    expect(composeUnits).not.toHaveBeenCalled();
    expect(engineLaunch.mock.calls[0][1].config.gameType).toBe(
      "SplinterFaction 2.0",
    );
  });
});
