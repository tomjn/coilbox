import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaReadMock = vi.fn();
const gameMissionsMock = vi.fn();
const gameMissionFileMock = vi.fn();

// The clip readers reach the plugin through bindings.ts, whose plugin-sdk
// import Vitest's node resolver cannot load from the published dist. Stubbing
// the bindings module is what storage.test.ts does for the same reason.
vi.mock("./bindings", () => ({
  scenarioMediaRead: (...args: unknown[]) => mediaReadMock(...args),
  scenarioGameMissions: (...args: unknown[]) => gameMissionsMock(...args),
  scenarioGameMissionFile: (...args: unknown[]) => gameMissionFileMock(...args),
}));

import { scenarioMediaUrl } from "../lib/assetUrl";
import { newScenario } from "./create";
import { gameScenarios } from "./gameScenarios";
import type { Scenario } from "./model";
import {
  dialogueClipUrl,
  gatherScenarioExport,
  readDialogueClip,
} from "./scenarioMedia";
import { encodeScenarioExport, readScenarioExport } from "./transfer";

const PORTRAIT = "data:image/png;base64,aGk=";

/** A stored scenario whose one dialogue line names a portrait. */
function withPortrait(id = "s1"): Scenario {
  return {
    ...newScenario("Beachhead"),
    id,
    dialogue: [
      { id: "d1", speaker: "Vega", text: "Hold.", portrait: "abc.png" },
    ],
  };
}

/** An installed game as the content scan hands one over. */
const game = (archive: string) =>
  ({
    name: "SplinterFaction",
    primaryArchive: { name: archive, path: `/games/${archive}` },
  }) as never;

/**
 * List SplinterFaction's one mission, so the app knows where it came from, and
 * hand back the mission's document. The archive answers `scenario.json` with
 * the document and anything else with the portrait's bytes.
 */
async function listedGameMission(
  archive = "sf.sdd",
  document = withPortrait("mission-1"),
): Promise<Scenario> {
  gameMissionsMock.mockResolvedValue({
    missions: [
      { folder: "first-contact", hasDocument: true, hasCompiled: true },
    ],
    stamp: null,
  });
  gameMissionFileMock.mockImplementation(async ({ file }: { file: string }) =>
    file === "scenario.json"
      ? { base64: btoa(JSON.stringify(document)) }
      : { base64: "aGk=" },
  );
  const [loaded] = await gameScenarios([game(archive)]);
  return loaded.scenario;
}

beforeEach(() => {
  vi.clearAllMocks();
  mediaReadMock.mockResolvedValue({ dataUrl: PORTRAIT });
});

describe("gatherScenarioExport", () => {
  it("inlines every referenced clip into the container", async () => {
    const { exported, missing } = await gatherScenarioExport(withPortrait());
    const read = readScenarioExport(encodeScenarioExport(exported));

    expect(mediaReadMock).toHaveBeenCalledWith({
      scenarioId: "s1",
      file: "abc.png",
    });
    expect(missing).toEqual([]);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.payload.media).toEqual({ "abc.png": PORTRAIT });
    expect(read.payload.scenario.dialogue[0].portrait).toBe("abc.png");
  });

  /**
   * A clip that cannot be read still leaves rather than sinking the export, but
   * it is named, so the share drawer can say what the export is short of rather
   * than handing out a mission with silent holes in it (issue #2235).
   */
  it("names a clip it could not read instead of dropping it in silence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mediaReadMock.mockRejectedValue(new Error("gone"));

    const { exported, missing } = await gatherScenarioExport(withPortrait());

    expect(exported.media).toEqual({});
    expect(missing).toEqual(["abc.png"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  /**
   * A mission a game ships keeps its portraits and voice clips inside the game
   * archive, beside the compiled mission, so they were never in the media store
   * an export used to read from. One that finds nothing there is a mission with
   * every radio message stripped of its picture and its voice (issue #2235).
   */
  it("inlines a game mission's clip out of the game archive", async () => {
    const mission = await listedGameMission();
    // Nothing under this scenario's id has ever been in the media store.
    mediaReadMock.mockRejectedValue(new Error("could not read media"));

    const { exported, missing } = await gatherScenarioExport(mission);

    expect(gameMissionFileMock).toHaveBeenCalledWith({
      root: "/games/sf.sdd",
      folder: "first-contact",
      file: "abc.png",
    });
    expect(missing).toEqual([]);
    expect(exported.media["abc.png"]).toBe(PORTRAIT);
    expect(mediaReadMock).not.toHaveBeenCalled();
  });

  /** A game whose archive cannot be read is a share that has to say so. */
  it("names a game mission's clip the archive would not give back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mission = await listedGameMission("packaged.sd7");
    gameMissionFileMock.mockRejectedValue(new Error("could not read abc.png"));

    const { exported, missing } = await gatherScenarioExport(mission);

    expect(exported.media).toEqual({});
    expect(missing).toEqual(["abc.png"]);
    warn.mockRestore();
  });
});

describe("readDialogueClip", () => {
  it("types a game mission's clip by its extension, so a webview draws it", async () => {
    const mission = await listedGameMission("typed.sdd");

    expect(await readDialogueClip(mission.id, "abc.png")).toBe(PORTRAIT);
    expect(await readDialogueClip(mission.id, "line.ogg")).toBe(
      "data:audio/ogg;base64,aGk=",
    );
    expect(await readDialogueClip(mission.id, "art.dds")).toBe(
      "data:application/octet-stream;base64,aGk=",
    );
  });
});

describe("dialogueClipUrl", () => {
  it("serves a stored scenario's clip over the scenario scheme", () => {
    expect(dialogueClipUrl("s1", "abc.png")).toBe(
      scenarioMediaUrl("s1", "abc.png"),
    );
  });

  /**
   * There is no such URL for a mission inside a game: the file is not on disk
   * anywhere the scheme handler could find it, so the panel has to read it.
   */
  it("has no URL for a game mission's clip", async () => {
    const mission = await listedGameMission("noscheme.sdd");

    expect(dialogueClipUrl(mission.id, "abc.png")).toBeNull();
  });
});
