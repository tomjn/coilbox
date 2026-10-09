import { beforeEach, describe, expect, it } from "vitest";
import type { ScanResult } from "./bindings";
import {
  forgetScanHints,
  gameArchivePath,
  gameRefs,
  mapHint,
  mapInScan,
  mapRefs,
  rememberScanHints,
} from "./scanHints";

function scan(): ScanResult {
  return {
    maps: [
      {
        name: "Aetherian Void 1.7",
        fileName: "maps/aetherian_void.smf",
        archives: [{ name: "Aetherian Void 1.7" }],
        info: {},
      },
      {
        name: "Resolved Map 1.0",
        fileName: "maps/resolved.smf",
        archives: [
          { name: "resolved_1.0.sd7", path: "/maps/resolved_1.0.sd7" },
        ],
        info: {},
      },
    ],
    games: [
      {
        name: "Splinter Faction",
        primaryArchive: {
          name: "SplinterFaction_0.1.86.sdz",
          path: "/games/SplinterFaction_0.1.86.sdz",
        },
        dependencyArchives: [],
        info: {},
      },
      {
        name: "No Path Game",
        primaryArchive: { name: "nopath.sdz" },
        dependencyArchives: [],
        info: {},
      },
    ],
    errors: [],
  };
}

beforeEach(() => forgetScanHints());

describe("what a scan hands the cached reads", () => {
  it("gives a game's archive path from the scan of the same target", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(
      gameArchivePath("/data", "/engine", "SplinterFaction_0.1.86.sdz"),
    ).toBe("/games/SplinterFaction_0.1.86.sdz");
  });

  it("gives nothing for a game the scan could not place", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(gameArchivePath("/data", "/engine", "nopath.sdz")).toBeUndefined();
    expect(gameArchivePath("/data", "/engine", "unknown.sdz")).toBeUndefined();
  });

  it("gives nothing for a target that was never scanned", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(
      gameArchivePath("/other", "/engine", "SplinterFaction_0.1.86.sdz"),
    ).toBeUndefined();
    expect(
      gameArchivePath("/data", "/other", "SplinterFaction_0.1.86.sdz"),
    ).toBeUndefined();
  });

  it("gives a name keyed map its file name and no archive path", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(mapHint("/data", "/engine", "Aetherian Void 1.7")).toEqual({
      archivePath: undefined,
      fileName: "maps/aetherian_void.smf",
    });
  });

  it("gives a map whose archive resolved that archive's path", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(mapHint("/data", "/engine", "Resolved Map 1.0")).toEqual({
      archivePath: "/maps/resolved_1.0.sd7",
      fileName: "maps/resolved.smf",
    });
  });

  it("gives an unknown map nothing", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(mapHint("/data", "/engine", "Nope")).toBeUndefined();
  });

  it("forgets a target when asked, and everything when not", () => {
    rememberScanHints("/data", "/engine", scan());
    rememberScanHints("/data2", "/engine", scan());
    forgetScanHints("/data", "/engine");
    expect(
      gameArchivePath("/data", "/engine", "SplinterFaction_0.1.86.sdz"),
    ).toBeUndefined();
    expect(
      gameArchivePath("/data2", "/engine", "SplinterFaction_0.1.86.sdz"),
    ).toBeDefined();
    forgetScanHints();
    expect(
      gameArchivePath("/data2", "/engine", "SplinterFaction_0.1.86.sdz"),
    ).toBeUndefined();
  });

  it("replaces an older scan of the same target", () => {
    rememberScanHints("/data", "/engine", scan());
    const next = scan();
    next.games = [];
    rememberScanHints("/data", "/engine", next);
    expect(
      gameArchivePath("/data", "/engine", "SplinterFaction_0.1.86.sdz"),
    ).toBeUndefined();
  });
});

describe("the lists of every map and game", () => {
  function listable(): ScanResult {
    const next = scan();
    next.games = next.games.slice(0, 1);
    return next;
  }

  it("lists the maps in scan order, naming only the keys each has", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(mapRefs("/data", "/engine")).toEqual([
      { name: "Aetherian Void 1.7", fileName: "maps/aetherian_void.smf" },
      {
        name: "Resolved Map 1.0",
        archivePath: "/maps/resolved_1.0.sd7",
        fileName: "maps/resolved.smf",
      },
    ]);
  });

  it("lists the games in scan order", () => {
    rememberScanHints("/data", "/engine", listable());
    expect(gameRefs("/data", "/engine")).toEqual([
      {
        name: "Splinter Faction",
        archivePath: "/games/SplinterFaction_0.1.86.sdz",
      },
    ]);
  });

  it("lists nothing for a target that was never scanned", () => {
    expect(mapRefs("/data", "/engine")).toBeUndefined();
    expect(gameRefs("/data", "/engine")).toBeUndefined();
  });

  it("lists nothing when the scan found none", () => {
    const empty = scan();
    empty.maps = [];
    empty.games = [];
    rememberScanHints("/data", "/engine", empty);
    expect(mapRefs("/data", "/engine")).toBeUndefined();
    expect(gameRefs("/data", "/engine")).toBeUndefined();
  });

  it("lists no maps when one has neither an archive path nor a file name", () => {
    const next = scan();
    next.maps.push({
      name: "Nameless",
      archives: [{ name: "Nameless" }],
      info: {},
    });
    rememberScanHints("/data", "/engine", next);
    expect(mapRefs("/data", "/engine")).toBeUndefined();
  });

  it("lists no games when one has no archive path", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(gameRefs("/data", "/engine")).toBeUndefined();
  });

  it("replaces the lists with a newer scan", () => {
    rememberScanHints("/data", "/engine", listable());
    const next = listable();
    next.maps = next.maps.slice(0, 1);
    next.games = [];
    rememberScanHints("/data", "/engine", next);
    expect(mapRefs("/data", "/engine")).toHaveLength(1);
    expect(gameRefs("/data", "/engine")).toBeUndefined();
  });

  it("forgets the lists with the target", () => {
    rememberScanHints("/data", "/engine", listable());
    forgetScanHints("/data", "/engine");
    expect(mapRefs("/data", "/engine")).toBeUndefined();
    expect(gameRefs("/data", "/engine")).toBeUndefined();
  });
});

describe("mapInScan", () => {
  it("says nothing for a target that was never scanned", () => {
    expect(mapInScan("/data", "/engine", "Aetherian Void 1.7")).toBeUndefined();
  });

  it("says whether the scan lists the map", () => {
    rememberScanHints("/data", "/engine", scan());
    expect(mapInScan("/data", "/engine", "Aetherian Void 1.7")).toBe(true);
    expect(mapInScan("/data", "/engine", "Nope")).toBe(false);
  });
});
