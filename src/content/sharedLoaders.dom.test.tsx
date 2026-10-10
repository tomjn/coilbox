// @vitest-environment happy-dom

/**
 * Callers asking for the same thing while a read is running share it (issue
 * #3720). Each loader here caches its result, but the cache is only written when
 * the answer lands, so a second caller arriving first used to start a second
 * worker for the same data.
 *
 * Every test uses its own target, because a finished read is remembered.
 */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  unitsyncScan: vi.fn(),
  unitsyncThumbnails: vi.fn(),
  unitsyncMapMeta: vi.fn(),
  unitsyncGameHeaders: vi.fn(),
  unitsyncMinimap: vi.fn(),
  unitsyncMapInfo: vi.fn(),
  unitsyncUnitBuildpics: vi.fn(),
  unitsyncArchiveTree: vi.fn(),
  unitsyncArchiveFile: vi.fn(),
  contentDemoInfo: vi.fn(),
}));

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  ...bindings,
}));

const {
  gatherExportPics,
  loadUnitsyncMinimap,
  primeGameHeaders,
  primeMapInfo,
  primeMapMeta,
  primeScan,
  primeThumbnails,
  useDemoInfo,
  useUnitsyncArchiveFile,
  useUnitsyncArchiveTree,
  useUnitsyncMapInfo,
  useUnitsyncUnitBuildpics,
} = await import("./config");

let n = 0;
let dir = "";

beforeEach(() => {
  for (const fn of Object.values(bindings)) fn.mockReset();
  // A new answer each time, as a real scan gives.
  bindings.unitsyncScan.mockImplementation(async () => ({
    maps: [],
    games: [],
    errors: [],
  }));
  n += 1;
  dir = `/data-${n}`;
});

afterEach(cleanup);

/** A promise the test settles by hand, so two callers can arrive before it does. */
function held<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("batch reads", () => {
  const reads = [
    [
      "thumbnails",
      primeThumbnails,
      bindings.unitsyncThumbnails,
      { thumbnails: [], errors: [] },
    ],
    [
      "map metadata",
      primeMapMeta,
      bindings.unitsyncMapMeta,
      { maps: [], errors: [] },
    ],
    [
      "game headers",
      primeGameHeaders,
      bindings.unitsyncGameHeaders,
      { headers: [], errors: [] },
    ],
  ] as const;

  for (const [label, prime, command, answer] of reads) {
    it(`makes one call for two callers asking for ${label} together`, async () => {
      const open = held<typeof answer>();
      command.mockReturnValue(open.promise);
      const first = prime("/engine", dir);
      const second = prime("/engine", dir);
      await vi.waitFor(() => expect(command).toHaveBeenCalled());
      open.resolve(answer);
      expect(await second).toBe(await first);
      expect(command).toHaveBeenCalledTimes(1);
    });

    it(`asks for ${label} again after a failure`, async () => {
      command.mockRejectedValueOnce(new Error("worker died"));
      command.mockResolvedValueOnce(answer);
      await expect(prime("/engine", dir)).rejects.toThrow("worker died");
      await prime("/engine", dir);
      expect(command).toHaveBeenCalledTimes(2);
    });

    it(`keeps ${label} for one scan and reads again for a newer one`, async () => {
      command.mockResolvedValue(answer);
      await prime("/engine", dir);
      await prime("/engine", dir);
      expect(command).toHaveBeenCalledTimes(1);

      await primeScan("/engine", dir, true);
      await prime("/engine", dir);
      expect(command).toHaveBeenCalledTimes(2);
    });

    it(`does not hand a caller after a rescan the ${label} read open from before it`, async () => {
      const open = held<typeof answer>();
      command.mockReturnValue(open.promise);
      const before = prime("/engine", dir);
      await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));

      await primeScan("/engine", dir, true);
      const after = prime("/engine", dir);
      // Both are open at once, and each reached the worker.
      await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
      open.resolve(answer);
      await Promise.all([before, after]);
    });
  }
});

describe("minimaps", () => {
  it("makes one call for two callers asking together", async () => {
    const open = held<{ file: string; startPositions: never[] }>();
    bindings.unitsyncMinimap.mockReturnValue(open.promise);
    const first = loadUnitsyncMinimap("/engine", dir, "Map", 3);
    const second = loadUnitsyncMinimap("/engine", dir, "Map", 3);
    await vi.waitFor(() => expect(bindings.unitsyncMinimap).toHaveBeenCalled());
    open.resolve({ file: "m-3.png", startPositions: [] });
    expect(await second).toBe(await first);
    expect(bindings.unitsyncMinimap).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failure", async () => {
    bindings.unitsyncMinimap.mockRejectedValueOnce(new Error("worker died"));
    bindings.unitsyncMinimap.mockResolvedValueOnce({ startPositions: [] });
    await expect(loadUnitsyncMinimap("/engine", dir, "Map")).rejects.toThrow(
      "worker died",
    );
    await loadUnitsyncMinimap("/engine", dir, "Map");
    expect(bindings.unitsyncMinimap).toHaveBeenCalledTimes(2);
  });
});

describe("map info", () => {
  const info = { checksum: 7, options: [], warnings: [], errors: [] };

  it("makes one call for two loader callers asking together", async () => {
    const open = held<typeof info>();
    bindings.unitsyncMapInfo.mockReturnValue(open.promise);
    const first = primeMapInfo("/engine", dir, "Map");
    const second = primeMapInfo("/engine", dir, "Map");
    await vi.waitFor(() => expect(bindings.unitsyncMapInfo).toHaveBeenCalled());
    open.resolve(info);
    expect(await second).toBe(await first);
    expect(bindings.unitsyncMapInfo).toHaveBeenCalledTimes(1);
  });

  it("makes one call for the loader and the hook asking together", async () => {
    const open = held<typeof info>();
    bindings.unitsyncMapInfo.mockReturnValue(open.promise);
    const loaded = primeMapInfo("/engine", dir, "Map");
    const hook = renderHook(() => useUnitsyncMapInfo("/engine", dir, "Map"));
    const second = renderHook(() => useUnitsyncMapInfo("/engine", dir, "Map"));
    await vi.waitFor(() => expect(bindings.unitsyncMapInfo).toHaveBeenCalled());
    open.resolve(info);
    await loaded;
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(bindings.unitsyncMapInfo).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failure", async () => {
    bindings.unitsyncMapInfo.mockRejectedValueOnce(new Error("worker died"));
    bindings.unitsyncMapInfo.mockResolvedValueOnce(info);
    await expect(primeMapInfo("/engine", dir, "Map")).rejects.toThrow(
      "worker died",
    );
    await primeMapInfo("/engine", dir, "Map");
    expect(bindings.unitsyncMapInfo).toHaveBeenCalledTimes(2);
  });
});

describe("build pictures", () => {
  it("makes one call for two hooks asking together", async () => {
    const open = held<{ units: Record<string, never> }>();
    bindings.unitsyncUnitBuildpics.mockReturnValue(open.promise);
    const a = renderHook(() =>
      useUnitsyncUnitBuildpics("/engine", dir, "Game", ["armcom"]),
    );
    const b = renderHook(() =>
      useUnitsyncUnitBuildpics("/engine", dir, "Game", ["armcom"]),
    );
    await vi.waitFor(() =>
      expect(bindings.unitsyncUnitBuildpics).toHaveBeenCalled(),
    );
    open.resolve({ units: {} });
    await waitFor(() => expect(a.result.current).not.toBeNull());
    await waitFor(() => expect(b.result.current).not.toBeNull());
    expect(bindings.unitsyncUnitBuildpics).toHaveBeenCalledTimes(1);
  });

  it("makes one call for two exports asking together", async () => {
    const open = held<{ units: Record<string, never> }>();
    bindings.unitsyncUnitBuildpics.mockReturnValue(open.promise);
    const first = gatherExportPics("/engine", dir, "Game", ["armcom"]);
    const second = gatherExportPics("/engine", dir, "Game", ["armcom"]);
    await vi.waitFor(() =>
      expect(bindings.unitsyncUnitBuildpics).toHaveBeenCalled(),
    );
    open.resolve({ units: {} });
    await Promise.all([first, second]);
    expect(bindings.unitsyncUnitBuildpics).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failure", async () => {
    bindings.unitsyncUnitBuildpics.mockRejectedValueOnce(new Error("died"));
    bindings.unitsyncUnitBuildpics.mockResolvedValueOnce({ units: {} });
    await expect(
      gatherExportPics("/engine", dir, "Game", ["armcom"]),
    ).rejects.toThrow("died");
    await gatherExportPics("/engine", dir, "Game", ["armcom"]);
    expect(bindings.unitsyncUnitBuildpics).toHaveBeenCalledTimes(2);
  });
});

describe("archive reads", () => {
  it("lists a tree once for two hooks asking together", async () => {
    const open = held<{ entries: never[] }>();
    bindings.unitsyncArchiveTree.mockReturnValue(open.promise);
    const a = renderHook(() => useUnitsyncArchiveTree("/engine", dir, "g.sdz"));
    const b = renderHook(() => useUnitsyncArchiveTree("/engine", dir, "g.sdz"));
    await vi.waitFor(() =>
      expect(bindings.unitsyncArchiveTree).toHaveBeenCalled(),
    );
    open.resolve({ entries: [] });
    await waitFor(() => expect(a.result.current.tree).not.toBeNull());
    await waitFor(() => expect(b.result.current.tree).not.toBeNull());
    expect(bindings.unitsyncArchiveTree).toHaveBeenCalledTimes(1);
  });

  it("lists a tree again after a failure", async () => {
    bindings.unitsyncArchiveTree.mockRejectedValueOnce(new Error("died"));
    bindings.unitsyncArchiveTree.mockResolvedValueOnce({ entries: [] });
    const first = renderHook(() =>
      useUnitsyncArchiveTree("/engine", dir, "g.sdz"),
    );
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const second = renderHook(() =>
      useUnitsyncArchiveTree("/engine", dir, "g.sdz"),
    );
    await waitFor(() => expect(second.result.current.tree).not.toBeNull());
    expect(bindings.unitsyncArchiveTree).toHaveBeenCalledTimes(2);
  });

  it("reads a member once for two hooks asking together", async () => {
    const open = held<{ kind: string }>();
    bindings.unitsyncArchiveFile.mockReturnValue(open.promise);
    const a = renderHook(() =>
      useUnitsyncArchiveFile("/engine", dir, "g.sdz", "a.lua"),
    );
    const b = renderHook(() =>
      useUnitsyncArchiveFile("/engine", dir, "g.sdz", "a.lua"),
    );
    await vi.waitFor(() =>
      expect(bindings.unitsyncArchiveFile).toHaveBeenCalled(),
    );
    open.resolve({ kind: "text" });
    await waitFor(() => expect(a.result.current.data).not.toBeNull());
    await waitFor(() => expect(b.result.current.data).not.toBeNull());
    expect(bindings.unitsyncArchiveFile).toHaveBeenCalledTimes(1);
  });
});

describe("replay info", () => {
  it("decodes a replay once for two hooks asking together", async () => {
    const open = held<{ info: { map: string } }>();
    bindings.contentDemoInfo.mockReturnValue(open.promise);
    const a = renderHook(() => useDemoInfo("/engine", `${dir}/a.sdfz`));
    const b = renderHook(() => useDemoInfo("/engine", `${dir}/a.sdfz`));
    await vi.waitFor(() => expect(bindings.contentDemoInfo).toHaveBeenCalled());
    open.resolve({ info: { map: "Map" } });
    await waitFor(() => expect(a.result.current.info).not.toBeNull());
    await waitFor(() => expect(b.result.current.info).not.toBeNull());
    expect(bindings.contentDemoInfo).toHaveBeenCalledTimes(1);
  });

  it("decodes again after a failure", async () => {
    bindings.contentDemoInfo.mockRejectedValueOnce(new Error("bad header"));
    bindings.contentDemoInfo.mockResolvedValueOnce({ info: { map: "Map" } });
    const first = renderHook(() => useDemoInfo("/engine", `${dir}/b.sdfz`));
    await waitFor(() => expect(first.result.current.error).toBe("bad header"));
    first.unmount();
    const second = renderHook(() => useDemoInfo("/engine", `${dir}/b.sdfz`));
    await waitFor(() => expect(second.result.current.info).not.toBeNull());
    expect(bindings.contentDemoInfo).toHaveBeenCalledTimes(2);
  });
});
