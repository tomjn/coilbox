import { describe, expect, it } from "vitest";
import type { GameItem } from "./bindings";
import type { useBrandingCatalog } from "./branding";
import { gameIconArt, gameIconKey } from "./gameIcon";

type Entries = ReturnType<typeof useBrandingCatalog>;

const archive = { name: "x.sdz", path: "/x.sdz", kind: "file" } as never;

function game(name: string, shortname: string, version: string): GameItem {
  return {
    name,
    primaryArchive: archive,
    dependencyArchives: [],
    info: { shortname, version },
  };
}

const INSTALLED = [
  game("Balanced Annihilation V15.9.8", "ba", "V15.9.8"),
  game("Balanced Annihilation V16.0.1", "ba", "V16.0.1"),
  game("Balanced Annihilation Remix V2.0", "bar", "V2.0"),
  game("Splinter Faction 0.1.86", "sf", "0.1.86"),
];

const ENTRIES: Entries = [
  {
    id: "splinter-faction",
    match: { regex: "^Splinter *Faction" },
    compiledRegex: /^Splinter *Faction/i,
    logo: ["https://example.test/sf.webp"],
    banner: ["https://example.test/sf-banner.webp"],
  },
  {
    id: "balanced-annihilation",
    match: { regex: "^Balanced *Annihilation", names: ["BA"] },
    compiledRegex: /^Balanced *Annihilation/i,
  },
];

describe("gameIconKey", () => {
  it("is shared by two versions of one game", () => {
    expect(gameIconKey("Balanced Annihilation V15.9.8", INSTALLED)).toBe(
      gameIconKey("Balanced Annihilation V16.0.1", INSTALLED),
    );
  });

  it("is not shared with a game whose name only starts the same way", () => {
    expect(gameIconKey("Balanced Annihilation V16.0.1", INSTALLED)).not.toBe(
      gameIconKey("Balanced Annihilation Remix V2.0", INSTALLED),
    );
  });

  it("matches a career title to the installed game's versions", () => {
    expect(gameIconKey("Balanced Annihilation", INSTALLED)).toBe(
      gameIconKey("Balanced Annihilation V15.9.8", INSTALLED),
    );
  });
});

describe("gameIconArt", () => {
  it("gives a game with catalog art its logo, banner and header", () => {
    expect(gameIconArt("Splinter Faction 0.1.86", INSTALLED, ENTRIES)).toEqual({
      logo: ["https://example.test/sf.webp"],
      banner: ["https://example.test/sf-banner.webp"],
      headerGame: "Splinter Faction 0.1.86",
    });
  });

  it("gives a game with no catalog art only its own header", () => {
    expect(
      gameIconArt("Balanced Annihilation V15.9.8", INSTALLED, ENTRIES),
    ).toEqual({ headerGame: "Balanced Annihilation V16.0.1" });
  });

  it("points two versions of one game at the same art, the newest", () => {
    expect(
      gameIconArt("Balanced Annihilation V15.9.8", INSTALLED, ENTRIES),
    ).toEqual(gameIconArt("Balanced Annihilation V16.0.1", INSTALLED, ENTRIES));
  });

  it("does not give a game another game's header on a shared prefix", () => {
    const art = gameIconArt(
      "Balanced Annihilation Remix V2.0",
      INSTALLED,
      ENTRIES,
    );
    expect(art.headerGame).toBe("Balanced Annihilation Remix V2.0");
  });

  it("gives a game that is not installed its catalog art and no header", () => {
    expect(gameIconArt("Splinter Faction 0.2.0", [], ENTRIES)).toEqual({
      logo: ["https://example.test/sf.webp"],
      banner: ["https://example.test/sf-banner.webp"],
    });
  });

  it("gives an unknown game nothing", () => {
    expect(gameIconArt("Some Other Game 1.0", INSTALLED, ENTRIES)).toEqual({});
  });

  it("gives nothing for a blank name", () => {
    expect(gameIconArt("", INSTALLED, ENTRIES)).toEqual({});
  });
});
