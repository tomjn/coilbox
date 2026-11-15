import { describe, expect, it } from "vitest";
import type { HubGame } from "../api";
import { MAP_VARIANTS, MINIMAP_VARIANT } from "../assets/vocabulary";
import type { MapFacts } from "../maps/lookup";
import { gamePresence, mapPresence } from "./status";

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
