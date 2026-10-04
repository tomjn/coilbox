// @vitest-environment happy-dom

/**
 * Importing a warpath challenge when the content scan failed (issue #3423). The
 * scan has no games then because the engine could not start, so the import must
 * not tell the player the challenge's game "isn't installed". The shared form is
 * stood in for, to reach the `finish` this wrapper hands it.
 *
 * Also a challenge made on a hand-made map (issue #3514): the map is read
 * first, and the import stops with the reason when this install has not got it.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { scan, shared, m } = vi.hoisted(() => ({
  scan: { error: null as string | null, games: [] as unknown[] },
  shared: {
    finish: null as
      | null
      | ((s: unknown, t: unknown, accepted?: boolean) => Promise<unknown>),
  },
  m: { loadMap: vi.fn(), runFromChallenge: vi.fn(), saveRun: vi.fn() },
}));

vi.mock("../../../challenge/ImportChallengeForm", () => ({
  ImportChallengeForm: (props: { finish: typeof shared.finish }) => {
    shared.finish = props.finish;
    return null;
  },
}));

vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: scan.error ? null : { games: scan.games, maps: [] },
    error: scan.error,
    loading: false,
  }),
}));

vi.mock("../../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ eligible: (maps: unknown[]) => maps }),
}));

vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
}));

vi.mock("../../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../runs", () => ({ useRuns: () => ({ saveRun: m.saveRun }) }));
vi.mock("../../../content/bindings", () => ({
  unitsyncSkirmishAis: async () => ({ ais: [] }),
  unitsyncGameInfo: async () => ({ sides: [] }),
  unitsyncUnitDataset: async () => ({ units: [] }),
}));
vi.mock("../../handmadeMap", () => ({ loadHandmadeRunMap: m.loadMap }));
vi.mock("../../challenge", () => ({
  decodeWarpathChallenge: vi.fn(),
  runFromChallenge: m.runFromChallenge,
  substitutedMapCount: () => 0,
}));

import { ImportChallengeForm } from "./ImportChallengeForm";

afterEach(() => {
  cleanup();
  scan.error = null;
  scan.games = [];
  shared.finish = null;
  vi.clearAllMocks();
});

const SETTINGS = { game: { shortname: "BAR" } };
const TARGET = { enginePath: "/engine", dataDir: "/data" };

async function finishMessage(settings: unknown = SETTINGS): Promise<string> {
  render(<ImportChallengeForm onImported={() => {}} />);
  try {
    await shared.finish?.(settings, TARGET, true);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "";
}

describe("ImportChallengeForm finish", () => {
  it("says the content scan failed, with the reason, when it did", async () => {
    scan.error = "no space left on device";

    const message = await finishMessage();

    expect(message).toMatch(/content scan failed/);
    expect(message).toMatch(/no space left on device/);
    expect(message).not.toMatch(/isn't installed/);
  });

  it("still says the game is not installed when the scan answered without it", async () => {
    expect(await finishMessage()).toMatch(/"BAR", which isn't installed/);
  });
});

describe("ImportChallengeForm finish, for a challenge on a hand-made map", () => {
  const ON_MAP = {
    game: { shortname: "TG" },
    map: { source: "handmade", id: "two-shores" },
  };
  const GAME = {
    name: "Test Game 1",
    primaryArchive: { name: "test_game_1.sdz" },
    dependencyArchives: [],
    info: { shortname: "TG", version: "1" },
  };

  it("stops with the reason when this install has not got the map", async () => {
    scan.games = [GAME];
    m.loadMap.mockResolvedValue({
      ok: false,
      message: 'No hand-made map with the id "two-shores" is installed.',
    });

    const message = await finishMessage(ON_MAP);

    expect(m.loadMap).toHaveBeenCalledWith("two-shores");
    expect(message).toMatch(/played on a hand-made map/);
    expect(message).toMatch(/"two-shores" is installed/);
    expect(message).toMatch(/Import the map/);
    expect(m.runFromChallenge).not.toHaveBeenCalled();
    expect(m.saveRun).not.toHaveBeenCalled();
  });

  it("hands the map it read to the run generator", async () => {
    scan.games = [GAME];
    const source = { map: { id: "two-shores" } };
    m.loadMap.mockResolvedValue({ ok: true, source });
    m.runFromChallenge.mockReturnValue({ nodes: [] });

    expect(await finishMessage(ON_MAP)).toBe("");

    const [, env] = m.runFromChallenge.mock.calls[0];
    expect(env.handmadeMap("two-shores")).toBe(source);
    expect(m.saveRun).toHaveBeenCalledTimes(1);
  });

  it("reads no map for a challenge that is not on a hand-made one", async () => {
    scan.games = [GAME];
    m.runFromChallenge.mockReturnValue({ nodes: [] });

    expect(await finishMessage({ game: { shortname: "TG" } })).toBe("");

    expect(m.loadMap).not.toHaveBeenCalled();
    const [, env] = m.runFromChallenge.mock.calls[0];
    expect(env.handmadeMap("anything")).toBeNull();
  });
});
