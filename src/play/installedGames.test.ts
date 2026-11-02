import { describe, expect, it } from "vitest";
import {
  candidateGames,
  compareGameVersions,
  decideLaunchGame,
  isTestBuild,
  resolveGameByShortname,
} from "./installedGames";

describe("compareGameVersions / resolveGameByShortname", () => {
  it("compares numeric segments numerically", () => {
    expect(compareGameVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareGameVersions("test-26575", "test-9999")).toBeGreaterThan(0);
    expect(compareGameVersions("2.0", "2.0")).toBe(0);
  });

  it("ranks a test build below a release, whatever the release's case", () => {
    for (const release of ["V15.9.8", "v15.9.8", "15.9.8", "1.0"]) {
      expect(compareGameVersions("test-7183-001edc3", release)).toBeLessThan(0);
      expect(compareGameVersions(release, "test-7183-001edc3")).toBeGreaterThan(
        0,
      );
    }
  });

  it("still orders test builds among themselves", () => {
    expect(
      compareGameVersions("test-26575-aaa", "test-9999-bbb"),
    ).toBeGreaterThan(0);
  });

  it("ranks an unversioned game and a $VERSION checkout below a test build", () => {
    for (const unversioned of ["", "  ", "$VERSION"]) {
      expect(
        compareGameVersions(unversioned, "test-30922-8064a43"),
      ).toBeLessThan(0);
      expect(
        compareGameVersions("test-30922-8064a43", unversioned),
      ).toBeGreaterThan(0);
    }
  });

  it("ranks an unversioned game and a $VERSION checkout below a release", () => {
    for (const unversioned of ["", "$VERSION"]) {
      for (const release of ["V15.9.8", "v15.9.8", "1.0"]) {
        expect(compareGameVersions(unversioned, release)).toBeLessThan(0);
        expect(compareGameVersions(release, unversioned)).toBeGreaterThan(0);
      }
    }
  });

  it("recognises a test build by its version", () => {
    expect(isTestBuild("test-7183-001edc3")).toBe(true);
    expect(isTestBuild("Test-7183")).toBe(true);
    expect(isTestBuild("V15.9.8")).toBe(false);
    expect(isTestBuild("1.0-testing")).toBe(false);
    expect(isTestBuild("")).toBe(false);
  });

  it("resolves the newest installed version of a shortname", () => {
    const games = [
      { name: "Game 1.9", info: { shortname: "TG", version: "1.9" } },
      { name: "Game 1.10", info: { shortname: "TG", version: "1.10" } },
      { name: "Other 9", info: { shortname: "XX", version: "9" } },
    ];
    expect(resolveGameByShortname({ shortname: "tg" }, games)?.name).toBe(
      "Game 1.10",
    );
    expect(
      resolveGameByShortname({ shortname: "nope" }, games),
    ).toBeUndefined();
  });

  it("prefers an exact pinned archive name", () => {
    const games = [
      { name: "Game 1.9", info: { shortname: "TG", version: "1.9" } },
      { name: "Game 1.10", info: { shortname: "TG", version: "1.10" } },
    ];
    expect(
      resolveGameByShortname({ shortname: "TG", pinnedName: "Game 1.9" }, games)
        ?.name,
    ).toBe("Game 1.9");
  });
});

const zk = (version: string) => ({
  name: `Zero-K v${version}`,
  info: { shortname: "ZK", version: `v${version}` },
});
const zkOld = zk("1.14.8.0");
const zkNew = zk("1.14.10.1");
const benchmark = {
  name: "Zero-K Benchmark v3",
  info: { shortname: "ZK", version: "v3" },
};

describe("games that share a shortname (issue #3465)", () => {
  it("never takes Zero-K Benchmark v3 for a newer Zero-K", () => {
    const ref = { shortname: "ZK", pinnedName: "Zero-K v1.14.10.1" };
    expect(resolveGameByShortname(ref, [zkNew, benchmark])?.name).toBe(
      "Zero-K v1.14.10.1",
    );
    // The chosen version is gone: the benchmark is not a stand-in for it.
    expect(resolveGameByShortname(ref, [benchmark])).toBeUndefined();
    expect(resolveGameByShortname(ref, [zkOld, benchmark])?.name).toBe(
      "Zero-K v1.14.8.0",
    );
  });

  it("does not guess between games when a ref names no version", () => {
    expect(
      resolveGameByShortname({ shortname: "ZK" }, [zkNew, benchmark]),
    ).toBeUndefined();
    expect(
      resolveGameByShortname({ shortname: "ZK" }, [zkOld, zkNew])?.name,
    ).toBe("Zero-K v1.14.10.1");
  });

  it("lists the games a ref can mean, newest first", () => {
    expect(
      candidateGames({ shortname: "zk" }, [zkOld, benchmark, zkNew]).map(
        (g) => g.name,
      ),
    ).toEqual(["Zero-K Benchmark v3", "Zero-K v1.14.10.1", "Zero-K v1.14.8.0"]);
    expect(
      candidateGames({ shortname: "zk", pinnedName: zkOld.name }, [
        zkOld,
        benchmark,
        zkNew,
      ]).map((g) => g.name),
    ).toEqual(["Zero-K v1.14.10.1", "Zero-K v1.14.8.0"]);
  });
});

describe("a game's test build beside its release (issue #4992)", () => {
  const ba = (name: string, version: string) => ({
    name,
    info: { shortname: "BA", version },
  });
  const v1597 = ba("Balanced Annihilation V15.9.7", "V15.9.7");
  const v1598 = ba("Balanced Annihilation V15.9.8", "V15.9.8");
  const test = ba(
    "Balanced Annihilation test-7183-001edc3",
    "test-7183-001edc3",
  );
  const ref = { shortname: "BA" };

  it("resolves a project made on V15.9.7 to the release, not the test build", () => {
    const pinned = { shortname: "BA", pinnedName: v1597.name };
    expect(resolveGameByShortname(pinned, [v1598, test])?.name).toBe(
      v1598.name,
    );
    expect(resolveGameByShortname(ref, [test, v1598])?.name).toBe(v1598.name);
  });

  it("lists the release first", () => {
    expect(candidateGames(ref, [test, v1598]).map((g) => g.name)).toEqual([
      v1598.name,
      test.name,
    ]);
  });

  it("uses the test build when it is the only one installed", () => {
    expect(resolveGameByShortname(ref, [test])?.name).toBe(test.name);
  });

  it("resolves a game whose builds are all test builds to the newest", () => {
    const older = ba("Beyond All Reason test-9999-abc", "test-9999-abc");
    const newer = ba("Beyond All Reason test-26575-def", "test-26575-def");
    expect(resolveGameByShortname(ref, [older, newer])?.name).toBe(newer.name);
  });

  it("does not offer the test build as an upgrade to a pinned release", () => {
    expect(
      decideLaunchGame({ shortname: "BA", pinnedName: v1598.name }, [
        v1598,
        test,
      ]),
    ).toEqual({ kind: "ready", game: v1598 });
  });

  it("does not offer a release as an upgrade to a pinned test build", () => {
    expect(
      decideLaunchGame({ shortname: "BA", pinnedName: test.name }, [
        v1598,
        test,
      ]),
    ).toEqual({ kind: "ready", game: test });
  });

  it("resolves a test build over a $VERSION checkout, as Beyond All Reason has", () => {
    const bar = (name: string, version?: string) => ({
      name,
      info:
        version === undefined
          ? { shortname: "BAR" }
          : { shortname: "BAR", version },
    });
    const rapid = bar(
      "Beyond All Reason test-30922-8064a43",
      "test-30922-8064a43",
    );
    const checkout = bar("Beyond All Reason", "$VERSION");
    const unversioned = bar("Beyond All Reason 1");
    const barRef = { shortname: "BAR" };
    expect(
      resolveGameByShortname(barRef, [checkout, unversioned, rapid])?.name,
    ).toBe(rapid.name);
    expect(
      candidateGames(barRef, [checkout, rapid, unversioned]).map((g) => g.name),
    ).toEqual([rapid.name, checkout.name, unversioned.name]);
  });

  it("never offers a $VERSION checkout or an unversioned game as an upgrade", () => {
    const checkout = ba("Balanced Annihilation", "$VERSION");
    const unversioned = {
      name: "Balanced Annihilation dev",
      info: { shortname: "BA" },
    };
    for (const pinned of [v1598, test]) {
      expect(
        decideLaunchGame({ shortname: "BA", pinnedName: pinned.name }, [
          pinned,
          checkout,
          unversioned,
        ]),
      ).toEqual({ kind: "ready", game: pinned });
    }
  });

  it("still offers a version to a pinned game that has none", () => {
    const checkout = ba("Balanced Annihilation", "$VERSION");
    expect(
      decideLaunchGame({ shortname: "BA", pinnedName: checkout.name }, [
        checkout,
        test,
      ]),
    ).toEqual({ kind: "upgrade", current: checkout, newer: test });
  });

  it("still offers a newer test build to a pinned test build", () => {
    const newer = ba("Balanced Annihilation test-9000-fff", "test-9000-fff");
    expect(
      decideLaunchGame({ shortname: "BA", pinnedName: test.name }, [
        v1598,
        test,
        newer,
      ]),
    ).toEqual({ kind: "upgrade", current: test, newer });
  });
});

describe("decideLaunchGame", () => {
  const pinned = { shortname: "ZK", pinnedName: "Zero-K v1.14.10.1" };

  it("launches a pinned game that is installed, beside the benchmark", () => {
    expect(decideLaunchGame(pinned, [zkNew, benchmark])).toEqual({
      kind: "ready",
      game: zkNew,
    });
  });

  it("offers a newer version of the same game when the pinned one is installed", () => {
    const newest = zk("1.15.0.0");
    expect(decideLaunchGame(pinned, [zkNew, newest, benchmark])).toEqual({
      kind: "upgrade",
      current: zkNew,
      newer: newest,
    });
  });

  it("does not offer the same upgrade again once declined, but offers a later one", () => {
    const newest = zk("1.15.0.0");
    expect(
      decideLaunchGame(pinned, [zkNew, newest], newest.name),
    ).toMatchObject({ kind: "ready", game: zkNew });
    const later = zk("1.16.0.0");
    expect(
      decideLaunchGame(pinned, [zkNew, newest, later], newest.name),
    ).toMatchObject({ kind: "upgrade", newer: later });
  });

  it("never offers the benchmark as an upgrade", () => {
    expect(decideLaunchGame(pinned, [zkNew, benchmark])).toMatchObject({
      kind: "ready",
    });
  });

  it("offers to continue on another version when the pinned one is gone", () => {
    const newest = zk("1.15.0.0");
    expect(decideLaunchGame(pinned, [newest, benchmark])).toEqual({
      kind: "continue",
      pinnedName: "Zero-K v1.14.10.1",
      newer: newest,
    });
  });

  it("is missing when the pinned game is gone and only an unrelated game shares its shortname", () => {
    expect(decideLaunchGame(pinned, [benchmark])).toEqual({
      kind: "missing",
      name: "Zero-K v1.14.10.1",
    });
  });

  it("pins the only game when a run names none", () => {
    expect(decideLaunchGame({ shortname: "ZK" }, [zkNew])).toEqual({
      kind: "ready",
      game: zkNew,
      pin: "Zero-K v1.14.10.1",
    });
  });

  it("asks when an unpinned run has several candidates, newest first", () => {
    const decision = decideLaunchGame({ shortname: "ZK" }, [
      zkOld,
      benchmark,
      zkNew,
    ]);
    expect(decision).toEqual({
      kind: "choose",
      candidates: [benchmark, zkNew, zkOld],
    });
  });

  it("is missing when an unpinned run has no candidate", () => {
    expect(decideLaunchGame({ shortname: "ZK" }, [])).toEqual({
      kind: "missing",
      name: "ZK",
    });
  });
});
