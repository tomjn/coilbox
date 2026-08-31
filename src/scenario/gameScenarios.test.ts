import { describe, expect, it, vi } from "vitest";

vi.mock("./bindings", () => ({
  scenarioGameMissions: vi.fn(),
  scenarioGameMissionFile: vi.fn(),
}));

import { scenarioGameMissionFile, scenarioGameMissions } from "./bindings";
import { gameScenarios } from "./gameScenarios";

const game = (name: string, archive: string) =>
  ({
    name,
    primaryArchive: { name: archive, path: `/games/${archive}` },
  }) as never;

const document = JSON.stringify({
  id: "6f1c9a4e-3b5d-4c7a-9f21-0e8b7d6a5c43",
  name: "First contact",
  runtimeVersion: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  setup: {
    gameName: "SplinterFaction",
    mapName: "AcidicQuarry",
    participants: [],
  },
  actors: [],
  groups: [],
  bases: [],
  zones: [],
  triggers: [],
  objectives: [],
  dialogue: [],
  variables: [],
});

describe("a game's own missions", () => {
  it("reads each mission that ships a document", async () => {
    vi.mocked(scenarioGameMissions).mockResolvedValue({
      missions: [
        { folder: "first-contact", hasDocument: true, hasCompiled: true },
        { folder: "compiled-only", hasDocument: false, hasCompiled: true },
      ],
      stamp: null,
    });
    vi.mocked(scenarioGameMissionFile).mockResolvedValue({
      base64: btoa(document),
    });

    const found = await gameScenarios([game("SplinterFaction", "sf.sdd")]);

    expect(found).toHaveLength(1);
    expect(found[0].source).toBe("game");
    expect(found[0].origin).toEqual({
      gameName: "SplinterFaction",
      archivePath: "/games/sf.sdd",
      folder: "first-contact",
      loose: true,
    });
  });

  it("marks a packaged game's mission as not loose", async () => {
    vi.mocked(scenarioGameMissions).mockResolvedValue({
      missions: [
        { folder: "first-contact", hasDocument: true, hasCompiled: true },
      ],
      stamp: "1024:1700000000",
    });
    vi.mocked(scenarioGameMissionFile).mockResolvedValue({
      base64: btoa(document),
    });

    const found = await gameScenarios([game("SplinterFaction", "sf.sd7")]);

    expect(found[0].origin?.loose).toBe(false);
  });

  it("never caches a loose mission's document, so an edit on disk shows up at once", async () => {
    vi.mocked(scenarioGameMissions).mockResolvedValue({
      missions: [
        { folder: "first-contact", hasDocument: true, hasCompiled: true },
      ],
      stamp: null,
    });
    const before = JSON.parse(document);
    const after = { ...before, name: "First contact, revised" };
    vi.mocked(scenarioGameMissionFile)
      .mockResolvedValueOnce({ base64: btoa(JSON.stringify(before)) })
      .mockResolvedValueOnce({ base64: btoa(JSON.stringify(after)) });

    const target = game("SplinterFaction", "sf.sdd");
    const first = await gameScenarios([target]);
    const second = await gameScenarios([target]);

    expect(first[0].scenario.name).toBe("First contact");
    expect(second[0].scenario.name).toBe("First contact, revised");
  });

  it("skips a game it cannot read rather than failing the whole list", async () => {
    vi.mocked(scenarioGameMissions).mockRejectedValue(
      new Error("no such game"),
    );

    await expect(gameScenarios([game("Gone", "gone.sdz")])).resolves.toEqual(
      [],
    );
  });
});
