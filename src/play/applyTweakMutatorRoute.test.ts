/**
 * The mutator route a preset panel takes for a game with no tweak slots
 * (issue #3122). What matters here is the settle-then-write order: typed
 * values are checked against the game before the mutator is written, a
 * failed or skipped settle still writes the mutator as typed, and the
 * returned note is exactly what the caller shows.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const project = {
  id: "p1",
  name: "Faster commanders",
  gameName: "Beyond All Reason",
  edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const WRITTEN = {
  units: { armcom: { maxdamage: { typed: 0.5, written: 5.5555553 } } },
};

const GENERATED_GAME = {
  name: "coilbox-workshop-test",
  primaryArchive: { name: "coilbox-workshop-test.sdd" },
};

const { primeScan, workshopTestMutator, settleTypedValues } = vi.hoisted(
  () => ({
    primeScan: vi.fn(async () => ({ games: [GENERATED_GAME], maps: [] })),
    workshopTestMutator: vi.fn(async () => ({
      dir: "/data/games/coilbox-workshop-test.sdd",
      folder: "coilbox-workshop-test.sdd",
      files: ["modinfo.lua"],
    })),
    settleTypedValues: vi.fn(
      async (_args: unknown): Promise<unknown> => ({
        ok: true,
        settled: {
          written: WRITTEN,
          fields: [
            {
              field: { kind: "unit", unit: "armcom", path: "maxdamage" },
              typed: 0.5,
              loadsAsTyped: 0.045,
              outcome: "written",
              written: 5.5555553,
            },
          ],
          loads: 3,
          elapsedMs: 900,
        },
      }),
    ),
  }),
);

vi.mock("@/content/config", () => ({ primeScan }));
vi.mock("@/lib/generatedGames", () => ({
  isWorkshopMutatorArchive: (name: string) => name.startsWith("coilbox-"),
}));
vi.mock("@/workshop/mutator", () => ({ workshopTestMutator }));
vi.mock("@/workshop/loadsAs", async () => {
  const actual =
    await vi.importActual<typeof import("@/workshop/loadsAs")>(
      "@/workshop/loadsAs",
    );
  return { ...actual, settleTypedValues };
});

const { applyTweakMutatorRoute } = await import("./applyTweakMutatorRoute");

const target = { enginePath: "/engines/105", dataDir: "/data" };

afterEach(() => {
  primeScan.mockClear();
  workshopTestMutator.mockClear();
  settleTypedValues.mockClear();
});

describe("applyTweakMutatorRoute", () => {
  it("settles typed values before writing the mutator, and names the game it wrote", async () => {
    const result = await applyTweakMutatorRoute({
      target,
      gameArchive: "byar.sdd",
      gameName: "Beyond All Reason",
      project,
    });

    expect(settleTypedValues).toHaveBeenCalledWith({
      enginePath: "/engines/105",
      dataDir: "/data",
      archive: "byar.sdd",
      project,
    });
    expect(workshopTestMutator).toHaveBeenCalledWith({
      dataDir: "/data",
      project,
      written: WRITTEN,
    });
    expect(primeScan).toHaveBeenCalledWith("/engines/105", "/data", true);
    expect(result).toEqual({
      gameType: GENERATED_GAME.name,
      archiveName: GENERATED_GAME.primaryArchive.name,
      typedNote: expect.stringMatching(/1 typed value is written/),
    });
  });

  it("writes the mutator as typed and says why when the game is not installed here", async () => {
    const result = await applyTweakMutatorRoute({
      target,
      gameArchive: undefined,
      gameName: "Beyond All Reason",
      project,
    });

    expect(settleTypedValues).not.toHaveBeenCalled();
    expect(workshopTestMutator).toHaveBeenCalledWith({
      dataDir: "/data",
      project,
      written: undefined,
    });
    expect(result.typedNote).toMatch(/is not installed here/);
  });

  it("writes the mutator as typed and says why when the settle itself fails", async () => {
    settleTypedValues.mockResolvedValueOnce({
      ok: false,
      message: "Coilbox could not load the game to check typed values",
    });

    const result = await applyTweakMutatorRoute({
      target,
      gameArchive: "byar.sdd",
      gameName: "Beyond All Reason",
      project,
    });

    expect(workshopTestMutator).toHaveBeenCalledWith({
      dataDir: "/data",
      project,
      written: undefined,
    });
    expect(result.typedNote).toBe(
      "Coilbox could not load the game to check typed values",
    );
  });

  it("throws when the rescan does not find the written archive", async () => {
    primeScan.mockResolvedValueOnce({
      games: [{ name: "not-it", primaryArchive: { name: "not-it.sdd" } }],
      maps: [],
    });

    await expect(
      applyTweakMutatorRoute({
        target,
        gameArchive: "byar.sdd",
        gameName: "Beyond All Reason",
        project,
      }),
    ).rejects.toThrow(/did not find it/);
  });
});
