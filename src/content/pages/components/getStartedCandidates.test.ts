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

describe("getStartedCandidates (issue #534)", () => {
  it("offers nothing to a user who already has a game and a map", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: new Set(["a"]) },
      scanSettled: true,
      scannedGames: [{ name: "Some Game", info: {} }] as never,
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a")],
    });
    expect(result.games).toHaveLength(0);
    expect(result.maps).toHaveLength(0);
  });

  it("offers maps to a user with a game but no maps", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: new Set() },
      scanSettled: true,
      scannedGames: [{ name: "Some Game", info: {} }] as never,
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a"), map("b")],
    });
    expect(result.games).toHaveLength(0);
    expect(result.maps.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("offers a game to a user with maps but no games", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: new Set(["a"]) },
      scanSettled: true,
      scannedGames: [],
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a")],
    });
    expect(result.games.map((g) => g.id)).toEqual(["bar"]);
    expect(result.maps).toHaveLength(0);
  });

  it("offers both to a fully un-onboarded user", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: new Set() },
      scanSettled: true,
      scannedGames: [],
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a"), map("b")],
    });
    expect(result.games.map((g) => g.id)).toEqual(["bar"]);
    expect(result.maps.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("withholds games until the unitsync scan settles, even with no maps installed", () => {
    const result = getStartedCandidates({
      installed: { games: new Set(), maps: new Set() },
      scanSettled: false,
      scannedGames: [],
      scopedGames: [game("bar")],
      entries: [],
      suggestedMaps: [map("a")],
    });
    expect(result.games).toHaveLength(0);
    expect(result.maps.map((m) => m.id)).toEqual(["a"]);
  });
});
