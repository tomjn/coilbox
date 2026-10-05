// @vitest-environment happy-dom
/**
 * A scenario location on a hand-made map, driven through the conquest battle
 * hook (issue #3515).
 *
 * The map is the sample in `docs/examples/handmade-map/`, read by the real
 * reader, so the scenario is the one an author would ship. The engine, the
 * disk and the replay reader are stubbed. What is pinned here is which launch
 * the hook makes, what it hands that launch, which signal it takes the result
 * from, and what it saves.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  detectBattleResult,
  engineLaunch,
  launchScenario,
  mediaWrite,
  saveFor,
  scanGames,
} = vi.hoisted(() => ({
  detectBattleResult: vi.fn(),
  engineLaunch: vi.fn(),
  launchScenario: vi.fn(),
  mediaWrite: vi.fn(async () => ({})),
  saveFor: vi.fn(async () => {}),
  scanGames: {
    list: [] as {
      name: string;
      info: Record<string, string>;
      primaryArchive: { name: string };
    }[],
  },
}));

vi.mock("../scenario/launch", () => ({ launchScenario }));
vi.mock("../scenario/bindings", () => ({ scenarioMediaWrite: mediaWrite }));
vi.mock("./conquests", () => ({ useConquestState: () => ({ saveFor }) }));

vi.mock("../content/bindings", () => ({
  contentListReplays: vi.fn(async () => ({ replays: [] })),
}));
vi.mock("../content/branding", () => ({ useBrandingEntry: () => undefined }));
vi.mock("../content/config", () => ({
  primeScan: vi.fn(async () => ({ games: scanGames.list })),
  useUnitsyncScan: () => ({
    data: {
      games: scanGames.list,
      maps: [{ name: "Comet Catcher Redux" }, { name: "MapA" }],
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

import { newHandmadeConquest } from "./handmade/conquest";
import { decodePng } from "./handmade/png.testhelper";
import { readHandmadeMap } from "./handmade/read";
import type { ConquestState, GalaxyDoc } from "./model";
import { useConquestBattleRun } from "./run";

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

const galaxy = sampleMap();
const ironcoast = galaxy.nodes.find((n) => n.id === "ironcoast");
if (!ironcoast) throw new Error("the sample has no Ironcoast");

/** A new conquest on the sample, already settled on `pinnedGame`, so the only
 * save a test sees is the one a battle makes. */
function freshState(pinnedGame = "Test Game 2.0"): ConquestState {
  return {
    ...newHandmadeConquest(
      galaxy,
      { seed: 7, fogOfWar: false, threatLevel: 0, playerFactionId: "west" },
      [{ name: "MapA", width: 8, height: 8 }],
      "2026-10-05T00:00:00.000Z",
    ),
    pinnedGame,
  };
}

/** The launch as `launchScenario` answers it once the engine has closed. */
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

function mount(
  state: ConquestState = freshState(),
  mode: "attack" | "defend" = "attack",
) {
  return renderHook(() => useConquestBattleRun(galaxy, state, ironcoast, mode));
}

beforeEach(() => {
  for (const mock of [
    detectBattleResult,
    engineLaunch,
    launchScenario,
    mediaWrite,
    saveFor,
  ]) {
    mock.mockClear();
  }
  scanGames.list = [
    {
      name: "Test Game 2.0",
      info: { shortname: "TG", version: "2.0" },
      primaryArchive: { name: "tg.sdz" },
    },
  ];
  launchScenario.mockResolvedValue(played());
  engineLaunch.mockResolvedValue({ exitCode: 0 });
  detectBattleResult.mockResolvedValue({ outcome: "victory", replay: null });
});

afterEach(cleanup);

describe("attacking a scenario location", () => {
  it("says which scenario the fight plays", () => {
    const { result } = mount();
    expect(result.current.scenario?.name).toBe("Siege");
    expect(result.current.canStart).toBe(true);
  });

  it("launches the scenario through the campaign's launch, on the conquest's game", async () => {
    const { result } = mount();
    await act(() => result.current.start());
    expect(launchScenario).toHaveBeenCalledTimes(1);
    const input = launchScenario.mock.calls[0][0];
    expect(input.reader).toBe("player");
    expect(input.dataDir).toBe("/data");
    expect(input.scenario.id).toBe("siege");
    // The scenario was made on "Test Game". The conquest is on a later build
    // of the same game, and that is the one it plays on.
    expect(input.scenario.setup.gameName).toBe("Test Game 2.0");
    // The runtime the scenario needs travels with it, for the launch to check.
    expect(input.scenario.runtimeVersion).toBe(
      ironcoast.scenario?.doc.runtimeVersion,
    );
    // No skirmish was started beside it.
    expect(engineLaunch).not.toHaveBeenCalled();
  });

  it("takes the location when the replay says the player won", async () => {
    const { result } = mount();
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("victory"));
    // The replay is asked about the name the scenario gave the player.
    expect(detectBattleResult.mock.calls[0][0].playerName).toBe("Commander");
    expect(result.current.autoDetected).toBe(true);
    expect(saveFor).toHaveBeenCalledTimes(1);
    const [mapId, saved] = saveFor.mock.calls[0] as unknown as [
      string,
      ConquestState,
    ];
    expect(mapId).toBe(galaxy.id);
    expect(saved.owners.ironcoast).toBe("west");
    expect(saved.handmade?.scenariosWon).toEqual(["ironcoast"]);
    expect(saved.history.at(-1)).toMatchObject({
      nodeId: "ironcoast",
      mode: "attack",
      outcome: "victory",
    });
  });

  it("counts a defeat as a lost battle and leaves the scenario to try again", async () => {
    detectBattleResult.mockResolvedValue({ outcome: "defeat", replay: null });
    const { result } = mount();
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("defeat"));
    const [, saved] = saveFor.mock.calls[0] as unknown as [
      string,
      ConquestState,
    ];
    expect(saved.owners.ironcoast).not.toBe("west");
    expect(saved.handmade?.scenariosWon).toBeUndefined();
    expect(saved.history.at(-1)).toMatchObject({ outcome: "defeat" });
  });

  it("asks the player when the replay does not say who won, and saves nothing until they answer", async () => {
    detectBattleResult.mockResolvedValue({
      outcome: "ambiguous",
      replay: null,
    });
    const { result } = mount();
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("result"));
    expect(saveFor).not.toHaveBeenCalled();

    await act(() => result.current.recordVictory());
    expect(result.current.phase).toBe("victory");
    expect(result.current.autoDetected).toBe(false);
    const [, saved] = saveFor.mock.calls[0] as unknown as [
      string,
      ConquestState,
    ];
    expect(saved.owners.ironcoast).toBe("west");
    expect(saved.handmade?.scenariosWon).toEqual(["ironcoast"]);
  });

  it("shows a refusal and saves nothing when the scenario will not launch", async () => {
    launchScenario.mockResolvedValue({
      ok: false,
      message: "This scenario needs a newer coilbox.",
      issues: [],
    });
    const { result } = mount();
    await act(() => result.current.start());
    expect(result.current.error).toBe("This scenario needs a newer coilbox.");
    expect(result.current.phase).toBe("briefing");
    expect(detectBattleResult).not.toHaveBeenCalled();
    expect(saveFor).not.toHaveBeenCalled();
  });

  it("does nothing when the launch is cancelled", async () => {
    launchScenario.mockResolvedValue(played(null));
    const { result } = mount();
    await act(() => result.current.start());
    expect(result.current.phase).toBe("briefing");
    expect(detectBattleResult).not.toHaveBeenCalled();
    expect(saveFor).not.toHaveBeenCalled();
  });

  it("refuses to play the scenario on a different game", async () => {
    scanGames.list = [
      {
        name: "Other Game 1.0",
        info: { shortname: "TG", version: "1.0" },
        primaryArchive: { name: "other.sdz" },
      },
    ];
    const { result } = mount(freshState("Other Game 1.0"));
    await act(() => result.current.start());
    expect(result.current.error).toContain("different game");
    expect(launchScenario).not.toHaveBeenCalled();
    expect(saveFor).not.toHaveBeenCalled();
  });

  it("checks for the scenario's map, not one swapped in for the skirmish", () => {
    const swapped = {
      ...ironcoast,
      battle: { ...ironcoast.battle, mapName: "MapA" },
    };
    const { result } = renderHook(() =>
      useConquestBattleRun(galaxy, freshState(), swapped, "attack"),
    );
    expect(result.current.mapName).toBe("Comet Catcher Redux");
    const defending = renderHook(() =>
      useConquestBattleRun(galaxy, freshState(), swapped, "defend"),
    );
    expect(defending.result.current.mapName).toBe("MapA");
  });

  it("puts the clips the file carried in the media store first", async () => {
    const withClip: GalaxyDoc = {
      ...galaxy,
      nodes: galaxy.nodes.map((n) =>
        n.scenario
          ? {
              ...n,
              scenario: {
                ...n.scenario,
                media: { "radio.ogg": "data:audio/ogg;base64,AAAA" },
              },
            }
          : n,
      ),
    };
    const node = withClip.nodes.find((n) => n.id === "ironcoast");
    const { result } = renderHook(() =>
      useConquestBattleRun(withClip, freshState(), node, "attack"),
    );
    await act(() => result.current.start());
    expect(mediaWrite).toHaveBeenCalledWith({
      scenarioId: "siege",
      file: "radio.ogg",
      dataUri: "data:audio/ogg;base64,AAAA",
    });
    expect(mediaWrite.mock.invocationCallOrder[0]).toBeLessThan(
      launchScenario.mock.invocationCallOrder[0],
    );
  });
});

describe("the other fights at a scenario location", () => {
  it("defends it as a skirmish on the scenario's map", async () => {
    const state: ConquestState = {
      ...freshState(),
      owners: { ...freshState().owners, ironcoast: "west" },
      incursions: [
        { nodeId: "ironcoast", factionId: "east", expiresOnTurn: 3 },
      ],
    };
    const { result } = mount(state, "defend");
    expect(result.current.scenario).toBeUndefined();
    expect(result.current.snapshot()?.mapName).toBe("Comet Catcher Redux");
    await act(() => result.current.start());
    expect(launchScenario).not.toHaveBeenCalled();
    expect(engineLaunch).toHaveBeenCalledTimes(1);
  });

  it("attacks it as a skirmish once the scenario has been won", async () => {
    const state: ConquestState = freshState();
    const won: ConquestState = {
      ...state,
      handmade: state.handmade && {
        ...state.handmade,
        scenariosWon: ["ironcoast"],
      },
    };
    const { result } = mount(won, "attack");
    expect(result.current.scenario).toBeUndefined();
    await act(() => result.current.start());
    expect(launchScenario).not.toHaveBeenCalled();
    expect(engineLaunch).toHaveBeenCalledTimes(1);
  });
});
