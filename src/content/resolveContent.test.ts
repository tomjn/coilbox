import { describe, expect, it } from "vitest";
import {
  type ContentRequirement,
  computeMissingRequirements,
  dedupeRequirements,
  engineVersionRequirement,
  exactGameRequirement,
  exactMapRequirement,
  gameMatchesShortId,
  gameNamesMatch,
  type InstalledContentSnapshot,
  installedGameShortId,
  normalizeGameIdentity,
  type ResolveReadings,
  resolveReplayShortGameId,
  resolveVerdict,
  stripVersionSuffix,
} from "./resolveContent";
import type { ScanReading } from "./scanSettled";

const installed = (
  over: Partial<InstalledContentSnapshot> = {},
): InstalledContentSnapshot => ({
  games: [{ name: "Beyond All Reason", shortname: "bar", version: "1.0" }],
  maps: ["Comet Catcher Redux"],
  engineVersions: ["105.1.1-2200-abcdef BAR"],
  ...over,
});

describe("dedupeRequirements", () => {
  it("keeps the first occurrence of each kind+label pair", () => {
    const reqs = [
      exactGameRequirement("BAR"),
      exactMapRequirement("Map A"),
      exactGameRequirement("BAR"),
      exactMapRequirement("Map A"),
      exactMapRequirement("Map B"),
    ];
    expect(dedupeRequirements(reqs).map((r) => `${r.kind}:${r.label}`)).toEqual(
      ["game:BAR", "map:Map A", "map:Map B"],
    );
  });
});

describe("computeMissingRequirements", () => {
  it("reports nothing missing when every requirement is installed", () => {
    const reqs = [
      exactGameRequirement("Beyond All Reason"),
      exactMapRequirement("Comet Catcher Redux"),
    ];
    expect(computeMissingRequirements(reqs, installed())).toEqual([]);
  });

  it("reports a missing game", () => {
    const reqs = [exactGameRequirement("Zero-K")];
    const missing = computeMissingRequirements(reqs, installed());
    expect(missing.map((r) => r.label)).toEqual(["Zero-K"]);
  });

  it("reports a missing map", () => {
    const reqs = [exactMapRequirement("Some Other Map")];
    const missing = computeMissingRequirements(reqs, installed());
    expect(missing.map((r) => r.label)).toEqual(["Some Other Map"]);
  });

  it("reports a missing engine version", () => {
    const reqs = [engineVersionRequirement("999.0.0")];
    const missing = computeMissingRequirements(reqs, installed());
    expect(missing.map((r) => r.label)).toEqual(["999.0.0"]);
  });

  it("dedupes before diffing, so a repeated requirement is reported once", () => {
    const reqs = [
      exactGameRequirement("Zero-K"),
      exactGameRequirement("Zero-K"),
    ];
    expect(computeMissingRequirements(reqs, installed())).toHaveLength(1);
  });

  it("mixes satisfied and missing requirements independently", () => {
    const reqs: ContentRequirement[] = [
      exactGameRequirement("Beyond All Reason"),
      exactMapRequirement("Missing Map"),
      engineVersionRequirement("999.0.0"),
    ];
    const missing = computeMissingRequirements(reqs, installed());
    expect(missing.map((r) => r.kind)).toEqual(["map", "engine"]);
  });

  it("supports a custom isInstalled predicate (shortname-based game match)", () => {
    const req: ContentRequirement = {
      kind: "game",
      label: "BAR",
      downloadKey: "bar",
      isInstalled: (i) =>
        i.games.some((g) => (g.shortname ?? "").toLowerCase() === "bar"),
    };
    expect(computeMissingRequirements([req], installed())).toEqual([]);
    expect(computeMissingRequirements([req], installed({ games: [] }))).toEqual(
      [req],
    );
  });
});

describe("resolveVerdict", () => {
  const SCANNING: ScanReading = {
    loading: true,
    data: null,
    error: null,
    cancelled: false,
  };
  const SCANNED: ScanReading = { ...SCANNING, loading: false, data: {} };
  /** What the readings carry before anything has answered: no games, no maps. */
  const nothingYet: InstalledContentSnapshot = {
    games: [],
    maps: [],
    engineVersions: [],
  };
  const readings = (over: Partial<ResolveReadings> = {}): ResolveReadings => ({
    requirements: [],
    installed: installed(),
    targetLoading: false,
    hasTarget: true,
    scan: SCANNED,
    enginesLoading: false,
    engineCatalogPending: false,
    ...over,
  });

  it("offers nothing while the target read is still in flight (issue #1377)", () => {
    // An import drawer opened before the install scan settles takes a target of
    // null, and the empty snapshot that comes with it is not a report of a
    // machine with nothing on it. Deciding here offers to download a game that
    // is already on disk.
    const verdict = resolveVerdict(
      readings({
        requirements: [exactGameRequirement("Beyond All Reason")],
        installed: nothingYet,
        targetLoading: true,
        hasTarget: false,
        scan: { ...SCANNING, loading: false },
      }),
    );
    expect(verdict.loading).toBe(true);
    expect(verdict.missing).toEqual([]);
    expect(verdict.resolved).toBe(false);
  });

  it("offers nothing while the scan is still running", () => {
    const verdict = resolveVerdict(
      readings({
        requirements: [exactGameRequirement("Beyond All Reason")],
        installed: nothingYet,
        scan: SCANNING,
      }),
    );
    expect(verdict.loading).toBe(true);
    expect(verdict.missing).toEqual([]);
  });

  it("does not read a scan that failed as an empty machine", () => {
    // Stricter than `scanSettled`, which the home page reads: a failed scan has
    // stopped, but it has not said what is on disk, and guessing costs a
    // download of something the reader already has.
    const verdict = resolveVerdict(
      readings({
        requirements: [exactGameRequirement("Beyond All Reason")],
        installed: nothingYet,
        scan: { ...SCANNING, loading: false, error: "no libunitsync found" },
      }),
    );
    expect(verdict.loading).toBe(true);
    expect(verdict.missing).toEqual([]);
  });

  it("offers the missing content once every reading has answered", () => {
    const verdict = resolveVerdict(
      readings({
        requirements: [
          exactGameRequirement("Beyond All Reason"),
          exactMapRequirement("Some Other Map"),
        ],
      }),
    );
    expect(verdict.loading).toBe(false);
    expect(verdict.missing.map((r) => r.label)).toEqual(["Some Other Map"]);
    expect(verdict.resolved).toBe(false);
  });

  it("resolves when the readings have answered and nothing is missing", () => {
    const verdict = resolveVerdict(
      readings({ requirements: [exactGameRequirement("Beyond All Reason")] }),
    );
    expect(verdict).toMatchObject({ loading: false, resolved: true });
  });

  it("treats a machine with no engine as an answer, not a wait", () => {
    // There is no scan to wait for and there never will be, so the gate offers
    // the engine rather than spinning forever.
    const verdict = resolveVerdict(
      readings({
        requirements: [engineVersionRequirement("105.1.1-2511")],
        installed: nothingYet,
        hasTarget: false,
        scan: { ...SCANNING, loading: false },
      }),
    );
    expect(verdict.loading).toBe(false);
    expect(verdict.missing.map((r) => r.label)).toEqual(["105.1.1-2511"]);
  });

  it("waits for the engine catalogs before judging an engine requirement", () => {
    const verdict = resolveVerdict(
      readings({
        requirements: [engineVersionRequirement("105.1.1-2511")],
        engineCatalogPending: true,
      }),
    );
    expect(verdict.loading).toBe(true);
    expect(verdict.missing).toEqual([]);
  });
});

describe("normalizeGameIdentity / gameNamesMatch", () => {
  it("collapses version-string form differences (issue #494)", () => {
    expect(normalizeGameIdentity("SplinterFaction 0.178")).toBe(
      normalizeGameIdentity("SplinterFaction v0.178"),
    );
    expect(normalizeGameIdentity("SplinterFaction 0.178")).toBe(
      normalizeGameIdentity("SplinterFaction 0.1.78"),
    );
  });

  it("recognises an installed game across version-string forms", () => {
    expect(
      gameNamesMatch("SplinterFaction 0.178", "SplinterFaction v0.178"),
    ).toBe(true);
    expect(
      gameNamesMatch("SplinterFaction 0.178", "SplinterFaction 0.1.78"),
    ).toBe(true);
    expect(
      gameNamesMatch(
        "Beyond All Reason test-30018",
        "Beyond All Reason test-30018",
      ),
    ).toBe(true);
  });

  it("still reports a genuinely absent game as not matching", () => {
    expect(gameNamesMatch("SplinterFaction 0.178", "Zero-K v1.10.6")).toBe(
      false,
    );
    expect(
      gameNamesMatch("SplinterFaction 0.178", "SplinterFaction 0.179"),
    ).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(
      gameNamesMatch("splinterfaction 0.178", "SPLINTERFACTION 0.178"),
    ).toBe(true);
  });
});

describe("stripVersionSuffix", () => {
  it("drops trailing version-looking words, keeping the family name", () => {
    expect(stripVersionSuffix("Beyond All Reason test-30018-d71d659")).toBe(
      "Beyond All Reason",
    );
    expect(stripVersionSuffix("SplinterFaction 0.178")).toBe("SplinterFaction");
  });

  it("leaves a name with no version-looking word unchanged", () => {
    expect(stripVersionSuffix("Zero-K")).toBe("Zero-K");
  });

  it("always keeps at least one word", () => {
    expect(stripVersionSuffix("30018")).toBe("30018");
  });
});

describe("resolveReplayShortGameId / gameMatchesShortId (issue #503)", () => {
  it("recovers a real shortname from an installed game of a different version", () => {
    const installedGames = [
      { name: "Beyond All Reason test-30050", shortname: "byar" },
    ];
    const shortId = resolveReplayShortGameId(
      "Beyond All Reason test-30018-d71d659",
      installedGames,
    );
    expect(shortId).toEqual({ id: "byar", exact: true });
    expect(gameMatchesShortId(shortId, installedGames[0])).toBe(true);
  });

  it("allows a same-shortname different version as a valid target", () => {
    const older = { name: "Beyond All Reason test-30018", shortname: "byar" };
    const newer = { name: "Beyond All Reason test-30050", shortname: "byar" };
    const shortId = resolveReplayShortGameId(older.name, [older, newer]);
    expect(gameMatchesShortId(shortId, older)).toBe(true);
    expect(gameMatchesShortId(shortId, newer)).toBe(true);
  });

  it("rejects a different game even when both are installed", () => {
    const bar = { name: "Beyond All Reason test-30018", shortname: "byar" };
    const zk = { name: "Zero-K v1.10.6", shortname: "zk" };
    const shortId = resolveReplayShortGameId(bar.name, [bar, zk]);
    expect(gameMatchesShortId(shortId, bar)).toBe(true);
    expect(gameMatchesShortId(shortId, zk)).toBe(false);
  });

  it("falls back to the version-stripped family identity with no installed match", () => {
    const zk = { name: "Zero-K v1.10.6", shortname: "zk" };
    const shortId = resolveReplayShortGameId("Some Uninstalled Game 4.2", [zk]);
    expect(shortId).toEqual({ id: "someuninstalledgame", exact: false });
    expect(gameMatchesShortId(shortId, zk)).toBe(false);
  });

  it("installedGameShortId prefers the real shortname over the family name", () => {
    expect(
      installedGameShortId({
        name: "Beyond All Reason test-30018",
        shortname: "byar",
      }),
    ).toBe("byar");
    expect(installedGameShortId({ name: "Zero-K v1.10.6" })).toBe("zerok");
  });
});
