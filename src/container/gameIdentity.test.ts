import { describe, expect, it } from "vitest";
import {
  gameIdentityForName,
  gameIdentityFromPayload,
  type InstalledGameInfo,
  parseGameIdentity,
} from "./gameIdentity";

describe("parseGameIdentity", () => {
  it("reads both spellings side by side", () => {
    expect(
      parseGameIdentity({ name: "SplinterFaction 0.1.78", shortname: "SF" }),
    ).toEqual({ name: "SplinterFaction 0.1.78", shortname: "SF" });
  });

  it("accepts an identity that only names a shortname", () => {
    expect(parseGameIdentity({ shortname: "BA" })).toEqual({ shortname: "BA" });
  });

  it("reads a bare string as an archive name", () => {
    expect(parseGameIdentity("BAR 1.2")).toEqual({ name: "BAR 1.2" });
  });

  it("reads the legacy gameName and pinnedName spellings as the name", () => {
    expect(parseGameIdentity({ gameName: "BAR 1.2" })).toEqual({
      name: "BAR 1.2",
    });
    expect(
      parseGameIdentity({ shortname: "BA", pinnedName: "BA V12" }),
    ).toEqual({ name: "BA V12", shortname: "BA" });
  });

  it("rejects a value naming no game", () => {
    expect(parseGameIdentity({})).toBeNull();
    expect(parseGameIdentity({ name: "  " })).toBeNull();
    expect(parseGameIdentity(null)).toBeNull();
    expect(parseGameIdentity(42)).toBeNull();
  });
});

describe("gameIdentityForName", () => {
  const installed: InstalledGameInfo[] = [
    { name: "BAR 1.2", info: { shortname: "BAR", version: "1.2" } },
    { name: "No modinfo", info: {} },
  ];

  it("fills the shortname in from the installed game's modinfo", () => {
    expect(gameIdentityForName("BAR 1.2", installed)).toEqual({
      name: "BAR 1.2",
      shortname: "BAR",
    });
  });

  it("carries the name alone when the game isn't installed here", () => {
    expect(gameIdentityForName("Something else", installed)).toEqual({
      name: "Something else",
    });
    expect(gameIdentityForName("No modinfo", installed)).toEqual({
      name: "No modinfo",
    });
  });

  it("rejects an empty name", () => {
    expect(gameIdentityForName("", installed)).toBeNull();
  });
});

describe("gameIdentityFromPayload", () => {
  it("prefers the shared field on every kind", () => {
    for (const kind of [
      "campaign",
      "preset",
      "challenge",
      "setup-pack",
      "scenario",
    ]) {
      expect(
        gameIdentityFromPayload(kind, {
          game: { name: "BAR 1.2", shortname: "BAR" },
        }),
      ).toEqual({ name: "BAR 1.2", shortname: "BAR" });
    }
  });

  it("reads a legacy setup pack's game.name", () => {
    expect(
      gameIdentityFromPayload("setup-pack", {
        game: { name: "SplinterFaction 0.1.78", rapidTag: "sf:test" },
        maps: ["Comet Catcher"],
      }),
    ).toEqual({ name: "SplinterFaction 0.1.78" });
  });

  it("reads a legacy challenge's settings.game.shortname", () => {
    expect(
      gameIdentityFromPayload("challenge", {
        mode: "conquest",
        settings: { game: { shortname: "BA", pinnedName: "BA V12.1" } },
      }),
    ).toEqual({ name: "BA V12.1", shortname: "BA" });
  });

  it("reads a legacy preset's gameName", () => {
    expect(
      gameIdentityFromPayload("preset", {
        gameName: "BAR 1.2",
        mapName: "Comet Catcher",
        participants: [],
      }),
    ).toEqual({ name: "BAR 1.2" });
  });

  it("reads a legacy scenario's setup.gameName", () => {
    expect(
      gameIdentityFromPayload("scenario", {
        scenario: { setup: { gameName: "BAR 1.2" } },
        media: {},
      }),
    ).toEqual({ name: "BAR 1.2" });
  });

  it("reads a legacy campaign's mission snapshots, both payload shapes", () => {
    const document = {
      type: "ta",
      missions: [
        { snapshot: { gameName: "BAR 1.2" } },
        { snapshot: { gameName: "BAR 1.2" } },
      ],
    };
    expect(gameIdentityFromPayload("campaign", document)).toEqual({
      name: "BAR 1.2",
    });
    expect(
      gameIdentityFromPayload("campaign", { campaign: document, media: {} }),
    ).toEqual({ name: "BAR 1.2" });
  });

  it("names no game for a campaign whose missions disagree", () => {
    expect(
      gameIdentityFromPayload("campaign", {
        type: "ta",
        missions: [
          { snapshot: { gameName: "BAR 1.2" } },
          { snapshot: { gameName: "BA V12.1" } },
        ],
      }),
    ).toBeNull();
  });

  it("names no game for a payload that names none", () => {
    expect(gameIdentityFromPayload("preset", {})).toBeNull();
    expect(gameIdentityFromPayload("preset", null)).toBeNull();
    expect(gameIdentityFromPayload("nonsense", { game: null })).toBeNull();
  });
});
