import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving an edit to a mission that lives in a game.
 *
 * The bindings are mocked because the write is a plugin command, but everything
 * else here is the real thing: the real `isEditable`, the real compiler, and the
 * real session cache behind `getCachedScenario`. The point of most of these is
 * that an edit does not quietly become a second copy in coilbox's own store, and
 * a mocked store would not be able to say so.
 */
vi.mock("./bindings", () => ({
  scenarioWriteGameMission: vi.fn(),
  scenarioSave: vi.fn(),
  scenarioList: vi.fn(),
  scenarioDelete: vi.fn(),
  scenarioMediaDelete: vi.fn(),
  scenarioMediaImport: vi.fn(),
  scenarioMediaRead: vi.fn(),
  scenarioMediaSweep: vi.fn(),
  scenarioMediaWrite: vi.fn(),
  scenarioGameMissions: vi.fn(),
  scenarioGameMissionFile: vi.fn(),
}));

// The real list, wrapped so a test can read what was published as well as
// whether it was published at all.
vi.mock("./scenarios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scenarios")>();
  return {
    ...actual,
    addGameMission: vi.fn(actual.addGameMission),
    forgetGameMission: vi.fn(actual.forgetGameMission),
  };
});

import { scenarioSave, scenarioWriteGameMission } from "./bindings";
import { compileScenario } from "./compile";
import { parseScenario, type Scenario } from "./model";
import { saveEditedScenario, saveMissionIntoGame } from "./saveIntoGame";
import {
  addGameMission,
  forgetGameMission,
  getCachedScenario,
} from "./scenarios";
import { isEditable, type LoadedScenario } from "./storage";

function build(id: string, name: string): Scenario {
  const scenario = parseScenario({ id, name, setup: {} });
  if (!scenario) throw new Error("fixture is not a valid scenario");
  return scenario;
}

function inGame(
  scenario: Scenario,
  loose: boolean,
  folder = "silence-the-jericho",
): LoadedScenario {
  return {
    scenario,
    source: "game",
    origin: {
      gameName: "SplinterFaction",
      archivePath: loose ? "/games/sf.sdd" : "/games/sf.sd7",
      folder,
      loose,
    },
  };
}

/** The list as it was last published, which is what the mission list and the
 *  editor route both read on the next mount. */
function published(): LoadedScenario[] {
  const results = vi.mocked(addGameMission).mock.results;
  const last = results[results.length - 1];
  if (last?.type !== "return") throw new Error("nothing was published");
  return last.value as LoadedScenario[];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scenarioWriteGameMission).mockResolvedValue({ dir: "/games/x" });
  vi.mocked(scenarioSave).mockResolvedValue({});
});

describe("saving a mission that lives in a loose game", () => {
  it("writes the document and the recompiled mission into the game", async () => {
    const scenario = build("s1", "Silence the Jericho");

    const saved = await saveMissionIntoGame(inGame(scenario, true), {
      ...scenario,
      name: "Silence the Jericho again",
    });

    expect(saved.name).toBe("Silence the Jericho again");
    expect(vi.mocked(scenarioWriteGameMission)).toHaveBeenCalledWith({
      root: "/games/sf.sdd",
      folder: "silence-the-jericho",
      document: JSON.stringify(saved),
      mission: compileScenario(saved),
    });
  });

  it("does not write a second copy into coilbox's own store", async () => {
    const scenario = build("s2", "Silence the Jericho");

    await saveMissionIntoGame(inGame(scenario, true, "jericho-two"), scenario);

    expect(vi.mocked(scenarioSave)).not.toHaveBeenCalled();
  });

  it("stamps the document the way a stored one is stamped", async () => {
    const scenario = {
      ...build("s3", "Jericho"),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const saved = await saveMissionIntoGame(
      inGame(scenario, true, "jericho-three"),
      scenario,
    );

    expect(saved.updatedAt).not.toBe(scenario.updatedAt);
    expect(saved.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(saved.runtimeVersion).toBeGreaterThan(0);
  });
});

describe("the list after a save", () => {
  it("shows the saved name rather than the one the archive was read with", async () => {
    const scenario = build("s4", "Silence the Jericho");
    const loaded = inGame(scenario, true, "jericho-four");
    addGameMission(loaded);

    await saveMissionIntoGame(loaded, { ...scenario, name: "Act one" });

    expect(getCachedScenario("s4")?.scenario.name).toBe("Act one");
  });

  it("replaces the entry rather than listing the mission twice", async () => {
    const scenario = build("s5", "Silence the Jericho");
    const loaded = inGame(scenario, true, "jericho-five");
    addGameMission(loaded);

    await saveMissionIntoGame(loaded, { ...scenario, name: "Act two" });

    expect(published().filter((l) => l.scenario.id === "s5")).toHaveLength(1);
  });

  it("keeps where the mission came from, so the next save goes to the same folder", async () => {
    const scenario = build("s6", "Jericho");
    const loaded = inGame(scenario, true, "jericho-six");
    addGameMission(loaded);

    await saveMissionIntoGame(loaded, scenario);

    expect(getCachedScenario("s6")?.origin).toEqual(loaded.origin);
    forgetGameMission(loaded.origin as NonNullable<typeof loaded.origin>);
  });
});

describe("a mission in a packaged game", () => {
  it("is not editable in the first place", () => {
    expect(isEditable(inGame(build("s7", "Jericho"), false))).toBe(false);
  });

  it("refuses the save and writes nothing", async () => {
    const scenario = build("s7", "Jericho");

    await expect(
      saveMissionIntoGame(inGame(scenario, false), scenario),
    ).rejects.toThrow(/packaged/);

    expect(vi.mocked(scenarioWriteGameMission)).not.toHaveBeenCalled();
    expect(vi.mocked(scenarioSave)).not.toHaveBeenCalled();
  });
});

describe("a write that fails", () => {
  it("is raised rather than swallowed, so the author is told", async () => {
    const scenario = build("s8", "Jericho");
    vi.mocked(scenarioWriteGameMission).mockRejectedValue(
      new Error("game folder is read only"),
    );

    await expect(
      saveMissionIntoGame(inGame(scenario, true, "jericho-eight"), scenario),
    ).rejects.toThrow(/read only/);
  });

  it("leaves the list alone, so nothing claims an edit that did not land", async () => {
    const scenario = build("s9", "Silence the Jericho");
    const loaded = inGame(scenario, true, "jericho-nine");
    addGameMission(loaded);
    vi.mocked(scenarioWriteGameMission).mockRejectedValue(
      new Error("game folder is read only"),
    );

    await expect(
      saveMissionIntoGame(loaded, { ...scenario, name: "Act three" }),
    ).rejects.toThrow();

    expect(getCachedScenario("s9")?.scenario.name).toBe("Silence the Jericho");
    forgetGameMission(loaded.origin as NonNullable<typeof loaded.origin>);
  });
});

describe("where an edit is written back to", () => {
  it("sends a game's mission into that game", async () => {
    const scenario = build("s10", "Jericho");

    await saveEditedScenario(inGame(scenario, true, "jericho-ten"), scenario);

    expect(vi.mocked(scenarioWriteGameMission)).toHaveBeenCalled();
    expect(vi.mocked(scenarioSave)).not.toHaveBeenCalled();
  });

  it("sends a local scenario to coilbox's store", async () => {
    const scenario = build("s11", "Jericho");

    await saveEditedScenario({ scenario, source: "local" }, scenario);

    expect(vi.mocked(scenarioSave)).toHaveBeenCalled();
    expect(vi.mocked(scenarioWriteGameMission)).not.toHaveBeenCalled();
  });

  it("still stores a document the list has not caught up with", async () => {
    const scenario = build("s12", "Jericho");

    await saveEditedScenario(undefined, scenario);

    expect(vi.mocked(scenarioSave)).toHaveBeenCalled();
  });
});
