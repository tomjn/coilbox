import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentState } from "../content/bindings";

const { contentRescan, contentStateLoad, primeScan } = vi.hoisted(() => ({
  contentRescan: vi.fn(),
  contentStateLoad: vi.fn(),
  primeScan: vi.fn(),
}));

vi.mock("../content/bindings", () => ({ contentRescan, contentStateLoad }));
vi.mock("../content/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../content/config")>()),
  primeScan,
}));

import { addedTargets, installEngine } from "./warmEngineCache";

/** A content snapshot with the given engine dirs under the given roots. */
const state = (roots: Record<string, string[]>): ContentState =>
  ({
    schemaVersion: 1,
    roots: Object.entries(roots).map(([path, engines]) => ({
      path,
      engines: engines.map((p) => ({ id: p, path: p, version: "1.0" })),
    })),
  }) as ContentState;

const ONE = state({ "/data": ["/engines/a"] });
const TWO = state({ "/data": ["/engines/a", "/engines/b"] });

beforeEach(() => {
  vi.clearAllMocks();
  contentStateLoad.mockResolvedValue({ state: ONE });
  contentRescan.mockResolvedValue({ state: TWO });
  primeScan.mockResolvedValue({ maps: [], games: [] });
});

describe("addedTargets", () => {
  it("names the engine an install added, paired with its content root", () => {
    expect(addedTargets(ONE, TWO)).toEqual([
      {
        rootPath: "/data",
        engineId: "/engines/b",
        enginePath: "/engines/b",
        engineVersion: "1.0",
      },
    ]);
  });

  it("finds nothing when the install replaced an engine in place", () => {
    expect(addedTargets(ONE, ONE)).toEqual([]);
  });

  it("finds an engine that arrived under a root of its own", () => {
    const other = state({ "/data": ["/engines/a"], "/other": ["/engines/c"] });
    expect(addedTargets(ONE, other).map((t) => t.rootPath)).toEqual(["/other"]);
  });

  it("finds nothing without a before snapshot, since every engine looks new", () => {
    expect(addedTargets(null, TWO)).toEqual([]);
  });
});

describe("installEngine", () => {
  it("warms the engine the install added, against its own content root", async () => {
    await installEngine(async () => ({ message: "ok" }));
    await vi.waitFor(() =>
      expect(primeScan).toHaveBeenCalledWith("/engines/b", "/data"),
    );
  });

  it("snapshots the engines before downloading, so the diff means something", async () => {
    const order: string[] = [];
    contentStateLoad.mockImplementation(async () => {
      order.push("load");
      return { state: ONE };
    });
    await installEngine(async () => {
      order.push("download");
    });
    expect(order).toEqual(["load", "download"]);
  });

  it("returns before the warm finishes, so the download stops reading as busy", async () => {
    let warmed = false;
    primeScan.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            warmed = true;
            resolve({ maps: [], games: [] });
          }, 0);
        }),
    );
    await installEngine(async () => ({ message: "ok" }));
    expect(warmed).toBe(false);
  });

  it("warms nothing when the install added no engine", async () => {
    contentRescan.mockResolvedValue({ state: ONE });
    await installEngine(async () => ({ message: "ok" }));
    expect(primeScan).not.toHaveBeenCalled();
  });

  it("still installs when the archive cache cannot be warmed", async () => {
    primeScan.mockRejectedValue(new Error("no libunitsync"));
    await expect(installEngine(async () => ({}))).resolves.toBeUndefined();
  });

  it("still installs when the content rescan fails", async () => {
    contentRescan.mockRejectedValue(new Error("root vanished"));
    await expect(installEngine(async () => ({}))).resolves.toBeUndefined();
    expect(primeScan).not.toHaveBeenCalled();
  });

  it("reports a failed download rather than swallowing it", async () => {
    await expect(
      installEngine(async () => {
        throw new Error("404");
      }),
    ).rejects.toThrow("404");
    expect(contentRescan).not.toHaveBeenCalled();
  });
});
