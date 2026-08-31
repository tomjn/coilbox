import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bindings", () => ({
  scenarioWriteGameMission: vi.fn(),
  scenarioDeleteMission: vi.fn(),
}));
vi.mock("./storage", () => ({
  deleteScenario: vi.fn(),
  saveScenario: vi.fn(),
}));

import { scenarioDeleteMission, scenarioWriteGameMission } from "./bindings";
import { parseScenario, type Scenario } from "./model";
import {
  missionFolderName,
  putMissionInGame,
  takeMissionOutOfGame,
} from "./moveIntoGame";
import { deleteScenario, type LoadedScenario, saveScenario } from "./storage";

function build(name: string): Scenario {
  const scenario = parseScenario({ id: "s1", name, setup: {} });
  if (!scenario) throw new Error("fixture is not a valid scenario");
  return scenario;
}

const game = (name: string, archive: string) =>
  ({
    name,
    primaryArchive: { name: archive, path: `/games/${archive}` },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scenarioWriteGameMission).mockResolvedValue({ dir: "/games/x" });
  vi.mocked(scenarioDeleteMission).mockResolvedValue({});
  vi.mocked(deleteScenario).mockResolvedValue(undefined);
  vi.mocked(saveScenario).mockImplementation(async (s) => s);
});

describe("the folder a mission gets in a game", () => {
  it("slugs the scenario's name so it reads as the game's content", () => {
    expect(missionFolderName("Silence the Jericho")).toBe(
      "silence-the-jericho",
    );
  });

  it("never produces something that looks like coilbox's own test folder", () => {
    expect(missionFolderName("6f1c9a4e-3b5d-4c7a-9f21-0e8b7d6a5c43")).toBe(
      "mission-6f1c9a4e-3b5d-4c7a-9f21-0e8b7d6a5c43",
    );
  });

  it("falls back rather than returning an empty folder", () => {
    expect(missionFolderName("!!!")).toBe("mission");
  });
});

describe("putting a mission into a game", () => {
  it("writes both files under the slugged folder and drops the local copy", async () => {
    const scenario = build("Silence the Jericho");

    const origin = await putMissionInGame(
      scenario,
      game("SplinterFaction", "sf.sdd"),
    );

    expect(vi.mocked(scenarioWriteGameMission)).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/games/sf.sdd",
        folder: "silence-the-jericho",
        document: JSON.stringify(scenario),
      }),
    );
    // The clips stay, because the mission still names them by the same names.
    expect(vi.mocked(deleteScenario)).toHaveBeenCalledWith("s1", {
      keepMedia: true,
    });
    expect(origin).toEqual({
      gameName: "SplinterFaction",
      archivePath: "/games/sf.sdd",
      folder: "silence-the-jericho",
      loose: true,
    });
  });

  it("slugs the folder the author typed, so a name with spaces still writes", async () => {
    await putMissionInGame(
      build("Silence the Jericho"),
      game("SplinterFaction", "sf.sdd"),
      "Act One",
    );

    expect(vi.mocked(scenarioWriteGameMission)).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "act-one" }),
    );
  });

  it("refuses a packaged game and writes nothing at all", async () => {
    await expect(
      putMissionInGame(build("Jericho"), game("SplinterFaction", "sf.sd7")),
    ).rejects.toThrow(/packaged/);

    expect(vi.mocked(scenarioWriteGameMission)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteScenario)).not.toHaveBeenCalled();
  });
});

describe("taking a mission back out of a game", () => {
  const loaded = (loose: boolean): LoadedScenario => ({
    scenario: build("Silence the Jericho"),
    source: "game",
    origin: {
      gameName: "SplinterFaction",
      archivePath: "/games/sf.sdd",
      folder: "silence-the-jericho",
      loose,
    },
  });

  it("stores the document first, then clears the game's folder", async () => {
    const back = await takeMissionOutOfGame(loaded(true));

    expect(back.name).toBe("Silence the Jericho");
    expect(vi.mocked(saveScenario)).toHaveBeenCalled();
    expect(vi.mocked(scenarioDeleteMission)).toHaveBeenCalledWith({
      root: "/games/sf.sdd",
      scenarioId: "silence-the-jericho",
    });
  });

  it("refuses a mission in a packaged game and removes nothing", async () => {
    await expect(takeMissionOutOfGame(loaded(false))).rejects.toThrow(
      /not in a game coilbox can write to/,
    );

    expect(vi.mocked(saveScenario)).not.toHaveBeenCalled();
    expect(vi.mocked(scenarioDeleteMission)).not.toHaveBeenCalled();
  });

  it("refuses a local scenario, which has no game folder to empty", async () => {
    await expect(
      takeMissionOutOfGame({ scenario: build("Jericho"), source: "local" }),
    ).rejects.toThrow(/not in a game coilbox can write to/);
  });
});
