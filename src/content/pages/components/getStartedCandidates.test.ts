import { describe, expect, it, vi } from "vitest";
import type { SuggestedGame, SuggestedMap } from "../../branding";

// getStartedCandidates.ts pulls in branding.ts, which pulls in
// @picoframe/plugin-sdk, so stub the leaf here too, matching branding.test.ts.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

const { getStartedCandidates, installedMapCount, MAPS_ENOUGH } = await import(
  "./getStartedCandidates"
);

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

// Enough maps to end the offer, named by the rule rather than by a literal, so
// the tests still say what they mean if the number moves.
const enoughMaps = () =>
  new Set(Array.from({ length: MAPS_ENOUGH }, (_, i) => `m${i}.sd7`));

describe("getStartedCandidates (issue #534)", () => {
  it("offers nothing to a user who already has a game and enough maps", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: enoughMaps() },
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
      installed: { games: new Set(), maps: enoughMaps() },
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
      scanned: scanned(["Some Game"], ["One", "Two", "Three"]),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a")],
    });
    expect(result?.maps).toHaveLength(0);
  });
});

// Issue #1116. The offer used to end the moment the player took one map, so a
// revisit after a single download came back to a page with no offer on it. It
// now ends when the player has a library rather than when it has been used.
describe("the offer stands until the player has enough maps", () => {
  const suggestedMaps = [map("a"), map("b"), map("c"), map("d")];
  const withMaps = (n: number) =>
    getStartedCandidates({
      installed: {
        games: new Set(),
        maps: new Set(Array.from({ length: n }, (_, i) => `have${i}.sd7`)),
      },
      scanned: scanned(["Some Game"], []),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps,
    });

  it("keeps offering after the first download", () => {
    expect(withMaps(1)?.maps.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("still offers one short of enough", () => {
    expect(withMaps(MAPS_ENOUGH - 1)?.maps).not.toHaveLength(0);
  });

  it("stands down at enough", () => {
    expect(withMaps(MAPS_ENOUGH)?.maps).toHaveLength(0);
  });

  it("drops a map the player took from the list it offers next", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: new Set() },
      scanned: scanned(["Some Game"], ["a"]),
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps,
    });
    expect(result?.maps.map((m) => m.id)).toEqual(["b", "c", "d"]);
  });
});

describe("installedMapCount", () => {
  // The two readings name the same map differently, so a player with three maps
  // that both readings can see has three, not six.
  it("does not add the two readings together", () => {
    expect(
      installedMapCount({
        installed: { maps: new Set(["a.sd7", "b.sd7", "c.sd7"]) },
        scanned: scanned([], ["A", "B", "C"]),
      }),
    ).toBe(3);
  });

  it("takes whichever reading saw more", () => {
    expect(
      installedMapCount({
        installed: { maps: new Set(["a.sd7"]) },
        scanned: scanned([], ["A", "B"]),
      }),
    ).toBe(2);
    expect(
      installedMapCount({
        installed: { maps: new Set(["a.sd7", "b.sd7"]) },
        scanned: scanned([], ["A"]),
      }),
    ).toBe(2);
  });
});
