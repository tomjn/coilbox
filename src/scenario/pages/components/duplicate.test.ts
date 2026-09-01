import { beforeEach, describe, expect, it, vi } from "vitest";

const saveMock = vi.fn();
const mediaReadMock = vi.fn();
const mediaWriteMock = vi.fn();

// storage.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbed the way
// storage.test.ts stubs it, so the copy runs against the real storage module.
vi.mock("../../bindings", () => ({
  scenarioSave: (...args: unknown[]) => saveMock(...args),
  scenarioMediaRead: (...args: unknown[]) => mediaReadMock(...args),
  scenarioMediaWrite: (...args: unknown[]) => mediaWriteMock(...args),
}));

import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import { copyName, duplicateScenario } from "./duplicate";

/** A scenario with one dialogue line, carrying a portrait and a voice clip. */
function withClips(): Scenario {
  const made = { ...newScenario("Beachhead"), id: "beachhead" };
  return {
    ...made,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-02T00:00:00.000Z",
    dialogue: [
      {
        id: "open",
        speaker: "Command",
        text: "Go.",
        portrait: "a.png",
        audio: "b.ogg",
      },
    ],
  };
}

/** The document written by the one save the copy made. */
const saved = (): Scenario => JSON.parse(saveMock.mock.calls[0][0].json);

beforeEach(() => {
  vi.clearAllMocks();
  mediaReadMock.mockResolvedValue({ dataUrl: "data:image/png;base64,AA==" });
  mediaWriteMock.mockResolvedValue({});
  saveMock.mockResolvedValue({});
});

describe("copyName", () => {
  it("names the first copy after the scenario it came from", () => {
    expect(copyName("Beachhead", [])).toBe("Copy of Beachhead");
  });

  it("counts up rather than repeating a name already in the list", () => {
    const taken = ["Beachhead", "Copy of Beachhead"];
    expect(copyName("Beachhead", taken)).toBe("Copy of Beachhead (2)");
    expect(copyName("Beachhead", [...taken, "Copy of Beachhead (2)"])).toBe(
      "Copy of Beachhead (3)",
    );
  });

  it("copies a copy without stacking the prefix twice", () => {
    expect(copyName("Copy of Beachhead", ["Copy of Copy of Beachhead"])).toBe(
      "Copy of Copy of Beachhead (2)",
    );
  });
});

describe("duplicateScenario", () => {
  it("writes a second document under a new id, leaving the original alone", async () => {
    const original = withClips();

    const copy = await duplicateScenario(original, ["Beachhead"]);

    expect(copy.id).not.toBe("beachhead");
    expect(copy.name).toBe("Copy of Beachhead");
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0].id).toBe(copy.id);
    // Nothing was written back over the scenario it came from.
    expect(saved().id).toBe(copy.id);
    expect(original.id).toBe("beachhead");
    expect(original.name).toBe("Beachhead");
  });

  /**
   * The point of the whole module. Clips are stored per scenario id, so a copy
   * that only took the document would name two files that do not exist under
   * its own id, and play silent.
   */
  it("copies the dialogue clips into the copy's own media folder", async () => {
    const copy = await duplicateScenario(withClips(), []);

    expect(mediaReadMock.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        { scenarioId: "beachhead", file: "a.png" },
        { scenarioId: "beachhead", file: "b.ogg" },
      ]),
    );
    expect(
      mediaWriteMock.mock.calls.map(({ 0: a }) => ({
        scenarioId: a.scenarioId,
        file: a.file,
      })),
    ).toEqual(
      expect.arrayContaining([
        { scenarioId: copy.id, file: "a.png" },
        { scenarioId: copy.id, file: "b.ogg" },
      ]),
    );
    // The file names travel unchanged, so the document still resolves.
    expect(saved().dialogue[0]).toMatchObject({
      portrait: "a.png",
      audio: "b.ogg",
    });
  });

  // A clip that cannot be read cannot be written, and a document naming a file
  // that is not there is the failure this module exists to avoid, so the
  // reference goes rather than the copy.
  it("drops a dialogue reference to a clip it could not copy", async () => {
    mediaReadMock.mockImplementation(async ({ file }: { file: string }) =>
      file === "a.png"
        ? { dataUrl: "data:image/png;base64,AA==" }
        : Promise.reject(new Error("gone")),
    );

    await duplicateScenario(withClips(), []);

    expect(saved().dialogue[0].portrait).toBe("a.png");
    expect(saved().dialogue[0].audio).toBeUndefined();
  });

  it("stamps the copy as written now rather than carrying the original's dates", async () => {
    const copy = await duplicateScenario(withClips(), []);

    expect(copy.createdAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(copy.updatedAt).not.toBe("2020-01-02T00:00:00.000Z");
    expect(Date.parse(copy.updatedAt)).toBeGreaterThan(Date.parse("2020-01-02"));
  });

  it("carries the rest of the document over", async () => {
    const original = {
      ...withClips(),
      description: "Hold the landing zone.",
      setup: {
        ...withClips().setup,
        gameName: "BAR",
        mapName: "Comet Catcher",
      },
    };

    const copy = await duplicateScenario(original, []);

    expect(copy.description).toBe("Hold the landing zone.");
    expect(copy.setup.gameName).toBe("BAR");
    expect(copy.setup.mapName).toBe("Comet Catcher");
  });
});
