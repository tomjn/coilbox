import { describe, expect, it, vi } from "vitest";
import type { SuggestedGame, SuggestedMap } from "../../branding";

// getStartedCandidates.ts pulls in branding.ts, which pulls in
// @picoframe/plugin-sdk, so stub the leaf here too, matching branding.test.ts.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

const { getStartedCandidates } = await import("./getStartedCandidates");

const game = (id: string): SuggestedGame => ({
  id,
  title: id,
  download: { kind: "rapid", tag: id },
});

const map = (id: string): SuggestedMap => ({
  id,
  title: id,
  download: { kind: "map", springName: id },
});

// A scanned game always carries the archive it came out of, and the archive
// name is what says whether coilbox generated the game itself.
const scanned = (games: string[], maps: string[]) =>
  ({
    games: games.map((name) => ({
      name,
      info: {},
      primaryArchive: { name: `${name}.sdz` },
    })),
    maps: maps.map((name) => ({ name })),
  }) as never;

const generated = (folder: string) =>
  ({
    games: [
      { name: "Coilbox test", info: {}, primaryArchive: { name: folder } },
    ],
    maps: [],
  }) as never;

const empty = { games: new Set<string>(), maps: new Set<string>() };

describe("getStartedCandidates (issue #534)", () => {
  it("offers nothing to a user who already has a game and a map", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: new Set(["a"]) },
      scanned: scanned(["Some Game"], []),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a")],
    });
    expect(result?.games).toHaveLength(0);
    expect(result?.maps).toHaveLength(0);
  });

  it("offers maps to a user with a game but no maps", () => {
    const result = getStartedCandidates({
      installed: empty,
      scanned: scanned(["Some Game"], []),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a"), map("b")],
    });
    expect(result?.games).toHaveLength(0);
    expect(result?.maps.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("offers a game to a user with maps but no games", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: new Set(["a"]) },
      scanned: scanned([], []),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a")],
    });
    expect(result?.games.map((g) => g.id)).toEqual(["bar"]);
    expect(result?.maps).toHaveLength(0);
  });

  it("offers both to a fully un-onboarded user", () => {
    const result = getStartedCandidates({
      installed: empty,
      scanned: scanned([], []),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a"), map("b")],
    });
    expect(result?.games.map((g) => g.id)).toEqual(["bar"]);
    expect(result?.maps.map((m) => m.id)).toEqual(["a", "b"]);
  });

  // Issue #810: coilbox writes these itself, so an install that has nothing but
  // one of them is still a first run and is still owed the offer.
  it.each([
    ["the unit builder's scratch game", "coilbox-lego-test.sdd"],
    ["the scenario test mutator", "coilbox-mission-test.sdd"],
  ])("does not count %s as a game the user has", (_label, folder) => {
    const result = getStartedCandidates({
      installed: { games: new Set([folder]), maps: new Set() },
      scanned: generated(folder),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [],
    });
    expect(result?.games.map((g) => g.id)).toEqual(["bar"]);
  });
});

describe("getStartedCandidates undecided cases", () => {
  it("has no verdict until the unitsync scan resolves", () => {
    expect(
      getStartedCandidates({
        installed: empty,
        scanned: null,
        scopedGames: [game("bar")],
        entries: [],
        suggestedMaps: [map("a")],
      }),
    ).toBeNull();
  });

  it("has no verdict until the installed listing is read", () => {
    expect(
      getStartedCandidates({
        installed: null,
        scanned: scanned([], []),
        scopedGames: [game("bar")],
        entries: [],
        suggestedMaps: [map("a")],
      }),
    ).toBeNull();
  });

  it("counts maps unitsync can see but the file listing missed", () => {
    const result = getStartedCandidates({
      installed: empty,
      scanned: scanned(["Some Game"], ["Some Map"]),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a")],
    });
    expect(result?.maps).toHaveLength(0);
  });
});
