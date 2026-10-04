import { describe, expect, it } from "vitest";
import type { GameItem } from "@/content/bindings";
import type { HubGame } from "./api";
import { hubIconUrl, matchHubGame } from "./gameIcons";

const HUB = "https://hub.example";
const CDN = "https://assets.example/coilbox-assets/";

describe("hubIconUrl", () => {
  it("resolves a root-relative path against the hub", () => {
    expect(hubIconUrl("/assets/games/SF/logo.png", HUB, CDN)).toBe(
      "https://hub.example/assets/games/SF/logo.png",
    );
  });

  it("keeps a hub served under a path prefix", () => {
    expect(hubIconUrl("/a/logo.png", `${HUB}/hub/`, CDN)).toBe(
      "https://hub.example/a/logo.png",
    );
  });

  it("accepts an absolute address on the hub's own host", () => {
    expect(hubIconUrl("https://hub.example/x/logo.png", HUB, CDN)).toBe(
      "https://hub.example/x/logo.png",
    );
  });

  it("accepts an absolute address under the hub's asset base, which is what the live hub sends", () => {
    expect(
      hubIconUrl(
        "https://assets.example/coilbox-assets/games/SF/logo.png",
        HUB,
        CDN,
      ),
    ).toBe("https://assets.example/coilbox-assets/games/SF/logo.png");
  });

  it("refuses a protocol-relative address to another host", () => {
    expect(hubIconUrl("//other.example/x.png", HUB, CDN)).toBeNull();
  });

  it("refuses an absolute address to another host", () => {
    expect(hubIconUrl("https://other.example/x.png", HUB, CDN)).toBeNull();
  });

  it("refuses the hub's name as a prefix of a longer host", () => {
    expect(
      hubIconUrl("https://hub.example.evil.test/x.png", HUB, CDN),
    ).toBeNull();
  });

  it("refuses the hub's name used as a username", () => {
    expect(
      hubIconUrl("https://hub.example@evil.test/x.png", HUB, CDN),
    ).toBeNull();
  });

  it("refuses credentials in the address, even on the hub's host", () => {
    expect(
      hubIconUrl("https://user:pw@hub.example/x.png", HUB, CDN),
    ).toBeNull();
  });

  it("refuses another path on the asset host", () => {
    expect(
      hubIconUrl("https://assets.example/other/x.png", HUB, CDN),
    ).toBeNull();
  });

  it("refuses a path that climbs out of the asset base", () => {
    expect(
      hubIconUrl(
        "https://assets.example/coilbox-assets/../other/x.png",
        HUB,
        CDN,
      ),
    ).toBeNull();
  });

  it("refuses a scheme other than https", () => {
    expect(hubIconUrl("javascript:alert(1)", HUB, CDN)).toBeNull();
    expect(hubIconUrl("data:image/png;base64,AAAA", HUB, CDN)).toBeNull();
    expect(hubIconUrl("http://hub.example/x.png", HUB, CDN)).toBeNull();
    expect(hubIconUrl("file:///etc/passwd", HUB, CDN)).toBeNull();
  });

  it("refuses everything when the hub itself is not https", () => {
    expect(hubIconUrl("/x.png", "http://hub.example", CDN)).toBeNull();
  });

  it("returns null for an empty, missing or unparseable value", () => {
    expect(hubIconUrl(null, HUB, CDN)).toBeNull();
    expect(hubIconUrl("  ", HUB, CDN)).toBeNull();
    expect(hubIconUrl("/x.png", "not a url", CDN)).toBeNull();
  });
});

const archive = { name: "x.sdz", path: "/x.sdz", kind: "file" } as never;
function installed(name: string, shortname: string, version: string): GameItem {
  return {
    name,
    primaryArchive: archive,
    dependencyArchives: [],
    info: { shortname, version },
  };
}
function hubGame(shortname: string, logo: string | null): HubGame {
  return {
    shortname,
    title: shortname,
    description: null,
    featured: false,
    downloads: [],
    logo,
    card: null,
    faction_count: 0,
    unit_count: 0,
    item_count: 0,
  };
}

const INSTALLED = [
  installed("Balanced Annihilation V15.9.8", "ba", "V15.9.8"),
  installed("Splinter Faction 0.1.86", "sf", "0.1.86"),
];
const GAMES = [
  hubGame("BA", "/ba.png"),
  hubGame("SF", "/sf.png"),
  hubGame("ZK", null),
];

describe("matchHubGame", () => {
  it("matches an installed game by its shortname, ignoring case", () => {
    expect(
      matchHubGame(GAMES, "Balanced Annihilation V15.9.8", INSTALLED)
        ?.shortname,
    ).toBe("BA");
  });

  it("matches a career title with no version", () => {
    expect(matchHubGame(GAMES, "Splinter Faction", INSTALLED)?.shortname).toBe(
      "SF",
    );
  });

  it("matches a game that is not installed when its name is the shortname", () => {
    expect(matchHubGame(GAMES, "ZK", INSTALLED)?.shortname).toBe("ZK");
  });

  it("does not match a game that is not installed and is named by its title", () => {
    expect(matchHubGame(GAMES, "Zero-K", INSTALLED)).toBeUndefined();
  });

  it("is undefined for a blank name", () => {
    expect(matchHubGame(GAMES, "  ", INSTALLED)).toBeUndefined();
  });

  it("is undefined while the list is not loaded", () => {
    expect(matchHubGame(null, "Splinter Faction", INSTALLED)).toBeUndefined();
  });
});
