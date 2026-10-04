import { describe, expect, it } from "vitest";
import {
  candidateGames,
  compareGameVersions,
  decideLaunchGame,
  resolveGameByShortname,
} from "./installedGames";

describe("compareGameVersions / resolveGameByShortname", () => {
  it("compares numeric segments numerically", () => {
    expect(compareGameVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareGameVersions("test-26575", "test-9999")).toBeGreaterThan(0);
    expect(compareGameVersions("2.0", "2.0")).toBe(0);
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
