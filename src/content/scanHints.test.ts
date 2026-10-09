import { beforeEach, describe, expect, it } from "vitest";
import type { ScanResult } from "./bindings";
import {
  forgetScanHints,
  gameArchivePath,
  mapHint,
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
