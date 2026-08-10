import { beforeEach, describe, expect, it } from "vitest";
import {
  gameIdentityForName,
  gameIdentityFromPayload,
  type InstalledGameInfo,
  parseGameIdentity,
} from "./gameIdentity";
import {
  rememberCarriedShortname,
  rememberShortnames,
  resetShortnames,
} from "./shortnames";

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

  beforeEach(resetShortnames);

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

  // Issue #1364: a mod's installed archive moves to a new exact name when it
  // updates, so pinning the build the player set the battle up on is enough to
  // lose the shortname on a machine that has read that game's modinfo.
  it("keeps the shortname when the pinned build has been superseded", () => {
    rememberShortnames([
      { name: "SplinterFaction 0.1.77", info: { shortname: "SF" } },
    ]);
    const nowInstalled: InstalledGameInfo[] = [
      { name: "SplinterFaction 0.1.78", info: { shortname: "SF" } },
    ];
    expect(gameIdentityForName("SplinterFaction 0.1.77", nowInstalled)).toEqual(
      {
        name: "SplinterFaction 0.1.77",
        shortname: "SF",
      },
    );
  });

  it("keeps pinning the build the item names, not the one installed now", () => {
    rememberShortnames([
      { name: "SplinterFaction 0.1.77", info: { shortname: "SF" } },
    ]);
    expect(gameIdentityForName("SplinterFaction 0.1.77", [])?.name).toBe(
      "SplinterFaction 0.1.77",
    );
  });

  it("prefers what the scan says now over what was read before", () => {
    rememberShortnames([{ name: "BAR 1.2", info: { shortname: "stale" } }]);
    expect(gameIdentityForName("BAR 1.2", installed)).toEqual({
      name: "BAR 1.2",
      shortname: "BAR",
    });
  });

  it("still names a game coilbox has never read a modinfo for by name alone", () => {
    expect(gameIdentityForName("Never seen 1.0", installed)).toEqual({
      name: "Never seen 1.0",
    });
  });

  // Issue #1383: a build this machine has never had is the ordinary case for
  // anything shared, so an item that arrived naming its game both ways lends
  // coilbox the shortname for as long as it is the only answer going.
  it("takes the shortname a shared container carried for a build never seen here", () => {
    rememberCarriedShortname({
      name: "SplinterFaction 0.1.60",
      shortname: "SF",
    });
    expect(gameIdentityForName("SplinterFaction 0.1.60", installed)).toEqual({
      name: "SplinterFaction 0.1.60",
      shortname: "SF",
    });
  });

  it("prefers a modinfo read here over what a container claimed", () => {
    rememberCarriedShortname({ name: "BAR 1.2", shortname: "Imposter" });
    rememberShortnames([
      { name: "SplinterFaction 0.1.77", info: { shortname: "SF" } },
    ]);
    rememberCarriedShortname({
      name: "SplinterFaction 0.1.77",
      shortname: "Imposter",
    });
    expect(gameIdentityForName("BAR 1.2", installed)?.shortname).toBe("BAR");
    expect(gameIdentityForName("SplinterFaction 0.1.77", [])?.shortname).toBe(
      "SF",
    );
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

  it("reads a setup pack's first game when it carries games but no game", () => {
    expect(
      gameIdentityFromPayload("setup-pack", {
        games: [
          { name: "BAR 1.2", shortname: "BAR" },
          { name: "SplinterFaction 0.1.78" },
        ],
      }),
    ).toEqual({ name: "BAR 1.2", shortname: "BAR" });
  });

  it("names no game for a setup pack with neither games nor game", () => {
    expect(
      gameIdentityFromPayload("setup-pack", { maps: ["Comet Catcher"] }),
    ).toBeNull();
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
