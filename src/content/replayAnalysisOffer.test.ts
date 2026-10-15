import { describe, expect, it } from "vitest";
import type { GameItem, StoredReplayAnalysis } from "./bindings";
import {
  divergedAttempts,
  type InstalledEngine,
  otherEngineOptions,
  otherGameVersion,
} from "./replayAnalysisOffer";

const engine = (
  name: string,
  over: Partial<InstalledEngine> = {},
): InstalledEngine => ({
  path: `/engines/${name}`,
  dataDir: "/data",
  version: name,
  ...over,
});

const OLD = engine("2025.06.19");
const MID = engine("2026.07.01-102-g6e5c5a0 macos_renderer-diagnostics");
const NEW = engine("2026.07.04-46-g04f42e2 macos_integration");
const ALL = [MID, OLD, NEW];

const offered = (
  over: Partial<Parameters<typeof otherEngineOptions>[0]> = {},
) =>
  otherEngineOptions({
    recorded: "2025.06.21",
    engines: ALL,
    headless: ALL.map((e) => e.path),
    attempts: [],
    game: "Some Game 1.0",
    ...over,
  });

describe("which engines an analysis is offered", () => {
  it("lists every installed headless engine, newest first", () => {
    expect(offered().map((o) => o.label)).toEqual([
      NEW.version,
      MID.version,
      OLD.version,
    ]);
  });

  it("leaves out an engine with no headless build", () => {
    const options = offered({ headless: [OLD.path, MID.path] });
    expect(options.map((o) => o.path)).toEqual([MID.path, OLD.path]);
  });

  it("offers nothing when no installed engine can run headless", () => {
    expect(offered({ headless: [] })).toEqual([]);
  });

  it("never offers the recorded engine as another one", () => {
    const options = offered({ recorded: "2026.07.01-102-g6e5c5a0" });
    expect(options.map((o) => o.path)).toEqual([NEW.path, OLD.path]);
  });

  it("goes by the version an engine reported over its folder name", () => {
    const renamed = engine("misnamed", { syncVersion: "2027.01.01" });
    const options = offered({
      engines: [OLD, renamed],
      headless: [OLD.path, renamed.path],
    });
    expect(options[0].path).toBe(renamed.path);
  });

  it("offers an engine with no real version, named by its folder", () => {
    const odd = engine(".spring", { path: "/odd/folder" });
    const options = offered({
      engines: [odd],
      headless: [odd.path],
    });
    expect(options.map((o) => o.label)).toEqual(["/odd/folder"]);
  });

  it("puts an engine that did not reproduce the match after the untried ones", () => {
    const options = offered({
      attempts: [
        {
          engine: "2026.07.04-46-g04f42e2 macos_integration",
          game: "Some Game 1.0",
          analysedAtMs: 1,
          disagreements: [],
        },
      ],
    });
    expect(options.map((o) => [o.label, o.tried])).toEqual([
      [MID.version, false],
      [OLD.version, false],
      [NEW.version, true],
    ]);
  });

  it("does not count an attempt made with another game version against this one", () => {
    const options = offered({
      attempts: [
        {
          engine: NEW.version,
          game: "Some Game 0.9",
          analysedAtMs: 1,
          disagreements: [],
        },
      ],
    });
    expect(options.every((o) => !o.tried)).toBe(true);
  });
});

describe("which game version stands in", () => {
  const game = (name: string) => ({ name }) as GameItem;

  it("is none when the exact game is installed", () => {
    expect(
      otherGameVersion("Some Game 1.0", [game("Some Game 1.0")]),
    ).toBeNull();
  });

  it("is the highest numbered installed version of the same game", () => {
    expect(
      otherGameVersion("Some Game 1.0", [
        game("Some Game 1.2"),
        game("Some Game 1.10"),
        game("Other Game 1.0"),
      ])?.name,
    ).toBe("Some Game 1.10");
  });

  it("is none when no version of the game is installed", () => {
    expect(
      otherGameVersion("Some Game 1.0", [game("Other Game 1.0")]),
    ).toBeNull();
  });
});

describe("the attempts a stored analysis holds", () => {
  const diverged = (over: Partial<StoredReplayAnalysis> = {}) =>
    ({
      outcome: "diverged",
      engine: "2026.07.01",
      game: "Some Game 1.0",
      analysedAtMs: 5,
      disagreements: [],
      ...over,
    }) as StoredReplayAnalysis;

  it("are none for nothing stored or for a reproduced run", () => {
    expect(divergedAttempts(undefined)).toEqual([]);
    expect(divergedAttempts(diverged({ outcome: "reproduced" }))).toEqual([]);
  });

  it("read a diverged file from before attempts were kept as one attempt", () => {
    expect(divergedAttempts(diverged())).toEqual([
      {
        engine: "2026.07.01",
        game: "Some Game 1.0",
        analysedAtMs: 5,
        disagreements: [],
      },
    ]);
  });

  it("are the file's own list when it has one", () => {
    const attempts = [
      { engine: "a", game: "g", analysedAtMs: 1, disagreements: [] },
      { engine: "b", game: "g", analysedAtMs: 2, disagreements: [] },
    ];
    expect(divergedAttempts(diverged({ attempts }))).toEqual(attempts);
  });
});
