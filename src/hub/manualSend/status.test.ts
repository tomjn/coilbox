import { describe, expect, it } from "vitest";
import type { HubGame } from "../api";
import { MAP_VARIANTS, MINIMAP_VARIANT } from "../assets/vocabulary";
import type { MapFacts } from "../maps/lookup";
import {
  gameHashes,
  gamePageUrl,
  gamePresence,
  mapHashes,
  mapPageUrl,
  mapPresence,
} from "./status";

const HUB = "https://hub.test/";

function hubGame(shortname: string, releases?: string[]): HubGame {
  return {
    shortname,
    title: shortname,
    description: null,
    featured: false,
    downloads: [],
    logo: null,
    card: null,
    faction_count: 0,
    unit_count: 0,
    item_count: 0,
    ...(releases ? { releases } : {}),
  };
}

describe("whether the hub has this release of a game", () => {
  it("does not know while the list has not come back", () => {
    expect(gamePresence(HUB, null, "sf", "1.0")).toEqual({ state: "unknown" });
  });

  it("is missing a game it does not list", () => {
    expect(gamePresence(HUB, [hubGame("ba", ["1"])], "sf", "1.0")).toEqual({
      state: "missing",
    });
  });

  it("is missing a release it does not hold", () => {
    expect(gamePresence(HUB, [hubGame("sf", ["0.9"])], "sf", "1.0")).toEqual({
      state: "missing",
    });
  });

  it("takes a hub that does not say which releases it holds at its listing", () => {
    expect(gamePresence(HUB, [hubGame("sf")], "sf", "1.0")).toEqual({
      state: "present",
      url: "https://hub.test/games/sf",
    });
  });

  it("has a release it holds, matching the shortname ignoring case", () => {
    expect(
      gamePresence(HUB, [hubGame("SF", ["1.0", "0.9"])], "sf", "1.0"),
    ).toEqual({ state: "present", url: "https://hub.test/games/SF" });
  });

  it("compares the release exactly, as the hub stores it", () => {
    expect(gamePresence(HUB, [hubGame("sf", ["v1.0"])], "sf", "1.0")).toEqual({
      state: "missing",
    });
  });
});

describe("whether the hub has a map", () => {
  const facts = { slug: "tabula-3" } as MapFacts;

  const every = new Set(MAP_VARIANTS);
  const minimapOnly = new Set([MINIMAP_VARIANT]);

  it("does not know until both answers are in", () => {
    expect(mapPresence(HUB, undefined, every)).toEqual({ state: "unknown" });
    expect(mapPresence(HUB, facts, undefined)).toEqual({ state: "unknown" });
  });

  it("is missing a map it has no facts for", () => {
    expect(mapPresence(HUB, null, every)).toEqual({ state: "missing" });
  });

  it("is missing a map it has no minimap of", () => {
    expect(mapPresence(HUB, facts, new Set(["overlay:height"]))).toEqual({
      state: "missing",
    });
  });

  it("is incomplete without its overlay layers, and still links to its page", () => {
    expect(mapPresence(HUB, facts, minimapOnly)).toEqual({
      state: "incomplete",
      url: "https://hub.test/map/tabula-3",
    });
  });

  it("has a map with every layer, and links to its page", () => {
    expect(mapPresence(HUB, facts, every)).toEqual({
      state: "present",
      url: "https://hub.test/map/tabula-3",
    });
  });
});

describe("the archives the hub lists, by hash", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  it("does not know a game's hashes until the listing is in", () => {
    expect(gameHashes(null, "sf")).toBeUndefined();
  });

  it("lists the hashes on a game's download sources, ignoring case in the shortname", () => {
    const sf: HubGame = {
      ...hubGame("SF"),
      downloads: [
        { kind: "url", value: "https://m.test/sf.sdz", sha256: A },
        { kind: "rapid", value: "sf:test" },
        { kind: "url", value: "https://m2.test/sf.sdz", sha256: B },
      ],
    };
    expect(gameHashes([sf], "sf")).toEqual(new Set([A, B]));
  });

  it("knows a game the hub does not list has no hashes", () => {
    expect(gameHashes([hubGame("other")], "sf")).toEqual(new Set());
  });

  it("does not know a map's hashes until the hub has answered", () => {
    expect(mapHashes(undefined)).toBeUndefined();
  });

  it("knows a map the hub has no facts for has none", () => {
    expect(mapHashes(null)).toEqual(new Set());
  });

  it("lists the hashes on a map's download sources", () => {
    const facts = {
      downloads: [
        { kind: "url", value: "https://m.test/t.sd7", sha256: A },
        { kind: "github", value: "owner/repo" },
      ],
    } as MapFacts;
    expect(mapHashes(facts)).toEqual(new Set([A]));
  });

  it("builds the pages a message links to", () => {
    expect(gamePageUrl(HUB, "S F")).toBe("https://hub.test/games/S%20F");
    expect(mapPageUrl(HUB, "tabula-3")).toBe("https://hub.test/map/tabula-3");
  });
});
