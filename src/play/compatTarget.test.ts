/**
 * Issue #4562. Which game a launch names depends on the game's own switch, and
 * a switch that is off must not touch the plugin, the scan or the mutator.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const compatStatus = vi.hoisted(() => vi.fn());
const primeGameInfo = vi.hoisted(() => vi.fn());
const primeScan = vi.hoisted(() => vi.fn());

vi.mock("../compat/bindings", () => ({
  compatStatus: (args: unknown) => compatStatus(args),
}));
vi.mock("../content/config", () => ({ primeGameInfo, primeScan }));

const { resolveCompatTarget } = await import("./compatTarget");

const TARGET = { enginePath: "/engines/105", dataDir: "/data" };
const GAME = {
  name: "XTA 9.65",
  primaryArchive: { name: "xta-9.65.sd7" },
};
const MUTATOR = {
  name: "XTA 9.65 (compat 2)",
  primaryArchive: { name: "coilbox-compat-xta-9.65-2.sdd" },
};
const ON: Record<string, { enabled: boolean; version: number }> = {
  "xta-9.65.sd7": { enabled: true, version: 2 },
};
const resolve = (settings = ON) =>
  resolveCompatTarget({ target: TARGET, game: GAME, settings });

beforeEach(() => {
  compatStatus.mockReset();
  primeGameInfo.mockReset();
  primeScan.mockReset();
  primeGameInfo.mockResolvedValue({ checksum: "1234abcd" });
  compatStatus.mockResolvedValue({
    latest: 2,
    folder: MUTATOR.primaryArchive.name,
    stale: [],
  });
  primeScan.mockResolvedValue({ games: [GAME, MUTATOR] });
});

describe("resolveCompatTarget", () => {
  it("substitutes the mutator's name when the switch is on and the mutator is fresh", async () => {
    expect(await resolve()).toEqual({
      kind: "use",
      gameType: "XTA 9.65 (compat 2)",
      gameArchive: MUTATOR.primaryArchive.name,
      baseName: "XTA 9.65",
    });
    expect(compatStatus).toHaveBeenCalledWith({
      dataDir: "/data",
      enginePath: "/engines/105",
      archiveName: "xta-9.65.sd7",
      baseChecksum: "1234abcd",
    });
  });

  it.each([
    ["has no entry", {}],
    ["is switched off", { "xta-9.65.sd7": { enabled: false, version: 2 } }],
  ])("leaves the game alone and reads nothing when it %s", async (_n, settings) => {
    expect(await resolve(settings)).toEqual({ kind: "off" });
    expect(primeGameInfo).not.toHaveBeenCalled();
    expect(compatStatus).not.toHaveBeenCalled();
    expect(primeScan).not.toHaveBeenCalled();
  });

  it("ignores another game's switch", async () => {
    expect(
      await resolve({ "other.sd7": { enabled: true, version: 1 } }),
    ).toEqual({ kind: "off" });
    expect(compatStatus).not.toHaveBeenCalled();
  });

  it("blocks on a stale mutator and names the reason and Rebuild", async () => {
    compatStatus.mockResolvedValue({
      latest: 3,
      folder: MUTATOR.primaryArchive.name,
      stale: [{ kind: "manifest", built: 2, now: 3 }],
    });
    const result = await resolve();
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") return;
    expect(result.message).toContain("out of date");
    expect(result.message).toContain("compatibility version 2, now 3");
    expect(result.message).toContain(
      "under Library > Games and choose Rebuild",
    );
  });

  it("names a changed palette as the reason a mutator is stale", async () => {
    compatStatus.mockResolvedValue({
      latest: 3,
      folder: MUTATOR.primaryArchive.name,
      stale: [
        {
          kind: "palette",
          built: { source: "springcontent.sdz", sha256: "aa" },
          now: { source: null, sha256: null },
        },
      ],
    });
    const result = await resolve();
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") return;
    expect(result.message).toContain(
      "the palette its models take their colours from has changed",
    );
  });

  it("blocks when the mutator was never built", async () => {
    compatStatus.mockResolvedValue({ latest: 2, folder: null, stale: [] });
    const result = await resolve();
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") return;
    expect(result.message).toContain("has not been built");
    expect(result.message).toContain("Rebuild");
  });

  it("rescans for a mutator the cached scan does not list yet", async () => {
    primeScan
      .mockResolvedValueOnce({ games: [GAME] })
      .mockResolvedValueOnce({ games: [GAME, MUTATOR] });
    expect((await resolve()).kind).toBe("use");
    expect(primeScan).toHaveBeenLastCalledWith("/engines/105", "/data", true);
  });

  it("blocks when the engine still does not list the mutator after a rescan", async () => {
    primeScan.mockResolvedValue({ games: [GAME] });
    expect((await resolve()).kind).toBe("blocked");
  });

  it("blocks rather than launching plain when the check itself fails", async () => {
    compatStatus.mockRejectedValue(new Error("plugin down"));
    const result = await resolve();
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") return;
    expect(result.message).toContain("plugin down");
  });
});
