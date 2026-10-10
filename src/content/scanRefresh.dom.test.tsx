// @vitest-environment happy-dom

/**
 * What a change to the library on disk costs the lists on screen (issue #3721).
 *
 * A finished download or a delete forgets the scans. Mounted lists then share
 * one rescan per target, keep what they show until it answers, and read their
 * thumbnails, metadata and headers again once, in one call each.
 *
 * Every test uses its own target, because a finished scan is remembered.
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanResult } from "./bindings";

const bindings = vi.hoisted(() => ({
  unitsyncScan: vi.fn(),
  unitsyncThumbnails: vi.fn(),
  unitsyncMapMeta: vi.fn(),
  unitsyncGameHeaders: vi.fn(),
  unitsyncLastScanWrite: vi.fn(),
  unitsyncLastScanRead: vi.fn(),
}));
const dlInstalledContent = vi.hoisted(() => vi.fn());

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  ...bindings,
}));
vi.mock("../downloads/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../downloads/bindings")>()),
  dlInstalledContent,
}));

const {
  forgetScans,
  invalidateScans,
  primeScan,
  rescanMounted,
  useUnitsyncGameHeaders,
  useUnitsyncMapMeta,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} = await import("./config");
const { installedContent } = await import("./installedContent");
const { readLastScan } = await import("./lastScan");
const { mapInScan } = await import("./scanHints");

const ENGINE = "/engine";
let n = 0;
let dir = "";

/** A scan listing these maps and one game. */
function scanOf(...maps: string[]): ScanResult {
  return {
    maps: maps.map((name) => ({
      name,
      fileName: `maps/${name}.smf`,
      archives: [],
      info: {},
    })),
    games: [
      {
        name: "Game 1.0",
        primaryArchive: { name: "game.sdz", path: "/games/game.sdz" },
        dependencyArchives: [],
        info: {},
      },
    ],
    errors: [],
  };
}

/** Answer each batch read with one entry per map or game of the newest scan. */
function answerBatchReadsFrom(current: () => ScanResult) {
  bindings.unitsyncThumbnails.mockImplementation(async () => ({
    thumbnails: current().maps.map((m) => ({ name: m.name, file: m.name })),
    errors: [],
  }));
  bindings.unitsyncMapMeta.mockImplementation(async () => ({
    maps: current().maps.map((m) => ({ name: m.name, info: { n: m.name } })),
    errors: [],
  }));
  bindings.unitsyncGameHeaders.mockImplementation(async () => ({
    headers: current().games.map((g) => ({ name: g.name, file: g.name })),
    errors: [],
  }));
}

/** A promise the test settles by hand. */
function held<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A Maps or Games page: the scan and the three batch reads. */
function usePage() {
  const scan = useUnitsyncScan(ENGINE, dir);
  const { thumbs } = useUnitsyncThumbnails(ENGINE, dir);
  const { meta } = useUnitsyncMapMeta(ENGINE, dir);
  const { headers } = useUnitsyncGameHeaders(ENGINE, dir);
  return { scan, thumbs, meta, headers };
}

/** Mount a page on a library of these maps and wait for it to fill in. */
async function mountedOn(...maps: string[]) {
  let current = scanOf(...maps);
  bindings.unitsyncScan.mockImplementation(async () => current);
  answerBatchReadsFrom(() => current);
  // Every render, so a test can say what the page showed along the way.
  const seen: { maps: number; thumbs: number; loading: boolean }[] = [];
  const page = renderHook(() => {
    const p = usePage();
    seen.push({
      maps: p.scan.data?.maps.length ?? 0,
      thumbs: p.thumbs.size,
      loading: p.scan.loading,
    });
    return p;
  });
  await waitFor(() => {
    expect(page.result.current.thumbs.size).toBe(maps.length);
    expect(page.result.current.meta.size).toBe(maps.length);
    expect(page.result.current.headers.size).toBe(1);
  });
  const calls = () => ({
    scan: bindings.unitsyncScan.mock.calls.length,
    thumbnails: bindings.unitsyncThumbnails.mock.calls.length,
    mapMeta: bindings.unitsyncMapMeta.mock.calls.length,
    gameHeaders: bindings.unitsyncGameHeaders.mock.calls.length,
  });
  return {
    page,
    seen,
    calls,
    /** Change what the disk holds. Nothing is told about it. */
    setDisk: (...next: string[]) => {
      current = scanOf(...next);
    },
  };
}

beforeEach(() => {
  for (const fn of Object.values(bindings)) fn.mockReset();
  bindings.unitsyncLastScanWrite.mockResolvedValue(null);
  dlInstalledContent.mockReset();
  dlInstalledContent.mockResolvedValue({ maps: [], games: [] });
  n += 1;
  dir = `/refresh-${n}`;
});

afterEach(cleanup);

describe("a mounted list after the library changes", () => {
  it("gains a downloaded map with one scan and one call per batch read", async () => {
    const { page, seen, calls, setDisk } = await mountedOn("A", "B");
    expect(calls()).toEqual({
      scan: 1,
      thumbnails: 1,
      mapMeta: 1,
      gameHeaders: 1,
    });
    const from = seen.length;

    setDisk("A", "B", "C");
    act(() => invalidateScans());

    await waitFor(() => expect(page.result.current.thumbs.size).toBe(3));
    await waitFor(() => expect(page.result.current.meta.size).toBe(3));
    expect(page.result.current.scan.data?.maps.map((m) => m.name)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect([...page.result.current.thumbs.keys()]).toEqual(["A", "B", "C"]);
    // One more of each, and no more: the rescan and one whole-library read.
    expect(calls()).toEqual({
      scan: 2,
      thumbnails: 2,
      mapMeta: 2,
      gameHeaders: 2,
    });
    // The list was never swapped for a skeleton or emptied on the way.
    for (const render of seen.slice(from)) {
      expect(render.loading).toBe(false);
      expect(render.maps).toBeGreaterThanOrEqual(2);
      expect(render.thumbs).toBeGreaterThanOrEqual(2);
    }
  });

  it("loses a map the fresh scan does not have, everywhere", async () => {
    const { page, setDisk } = await mountedOn("A", "B");
    expect(mapInScan(dir, ENGINE, "B")).toBe(true);

    setDisk("A");
    act(() => invalidateScans(true));
    // A delete drops the list at once, before the rescan has answered.
    expect(page.result.current.scan.data).toBeNull();
    expect(mapInScan(dir, ENGINE, "B")).toBeUndefined();

    await waitFor(() =>
      expect(page.result.current.scan.data?.maps).toHaveLength(1),
    );
    await waitFor(() => expect(page.result.current.thumbs.size).toBe(1));
    await waitFor(() => expect(page.result.current.meta.size).toBe(1));
    expect(page.result.current.thumbs.has("B")).toBe(false);
    expect(page.result.current.meta.has("B")).toBe(false);
    expect(mapInScan(dir, ENGINE, "B")).toBe(false);
    expect((await primeScan(ENGINE, dir)).maps.map((m) => m.name)).toEqual([
      "A",
    ]);
  });

  it("reads again for an archive replaced by a file of the same name", async () => {
    // The scan lists the same names, so only the plugin, which stats each
    // archive, can tell. The read has to reach it.
    const { page, calls, setDisk } = await mountedOn("A", "B");
    const before = page.result.current.thumbs;

    setDisk("A", "B");
    act(() => invalidateScans());

    await waitFor(() => expect(page.result.current.thumbs).not.toBe(before));
    await waitFor(() =>
      expect(calls()).toEqual({
        scan: 2,
        thumbnails: 2,
        mapMeta: 2,
        gameHeaders: 2,
      }),
    );
  });

  it("refreshes everything on a manual Rescan", async () => {
    const { page, calls, setDisk } = await mountedOn("A", "B");

    setDisk("A", "B", "C");
    await act(async () => {
      await page.result.current.scan.run(true);
    });

    await waitFor(() => expect(page.result.current.thumbs.size).toBe(3));
    await waitFor(() =>
      expect(calls()).toEqual({
        scan: 2,
        thumbnails: 2,
        mapMeta: 2,
        gameHeaders: 2,
      }),
    );
  });

  it("does not read again when nothing was forgotten", async () => {
    const { calls } = await mountedOn("A");
    act(() => rescanMounted());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls()).toEqual({
      scan: 1,
      thumbnails: 1,
      mapMeta: 1,
      gameHeaders: 1,
    });
  });
});

describe("rescans that would overlap", () => {
  it("runs one scan for several mounted consumers", async () => {
    bindings.unitsyncScan.mockImplementation(async () => scanOf("A"));
    const hooks = [1, 2, 3].map(() =>
      renderHook(() => useUnitsyncScan(ENGINE, dir)),
    );
    await waitFor(() => {
      for (const h of hooks) expect(h.result.current.data).not.toBeNull();
    });
    expect(bindings.unitsyncScan).toHaveBeenCalledTimes(1);

    bindings.unitsyncScan.mockImplementation(async () => scanOf("A", "B"));
    act(() => {
      forgetScans();
      // Each consumer asks, as `useResolveContent` does on a completion.
      for (const _ of hooks) rescanMounted();
    });

    await waitFor(() => {
      for (const h of hooks)
        expect(h.result.current.data?.maps).toHaveLength(2);
    });
    expect(bindings.unitsyncScan).toHaveBeenCalledTimes(2);
  });

  it("follows a scan the change overtook with one more, however many changes arrive", async () => {
    bindings.unitsyncScan.mockImplementation(async () => scanOf("A"));
    const { result } = renderHook(() => useUnitsyncScan(ENGINE, dir));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    // The rule: one scan running, and at most one more queued behind it.
    const running = held<ScanResult>();
    bindings.unitsyncScan.mockImplementationOnce(() => running.promise);
    bindings.unitsyncScan.mockImplementation(async () =>
      scanOf("A", "B", "C", "D", "E"),
    );
    act(() => invalidateScans());
    expect(bindings.unitsyncScan).toHaveBeenCalledTimes(2);
    // Four more downloads finish while that scan is still listing folders.
    act(() => {
      for (let i = 0; i < 4; i++) invalidateScans();
    });
    expect(bindings.unitsyncScan).toHaveBeenCalledTimes(2);

    // It answers with what it saw, which is not everything.
    await act(async () => {
      running.resolve(scanOf("A", "B"));
      await running.promise;
    });

    await waitFor(() => expect(result.current.data?.maps).toHaveLength(5));
    // The first scan, the overtaken one, and one more. Not one per change.
    expect(bindings.unitsyncScan).toHaveBeenCalledTimes(3);
    // The overtaken answer was not kept as the library.
    expect((await primeScan(ENGINE, dir)).maps).toHaveLength(5);
    expect(bindings.unitsyncScan).toHaveBeenCalledTimes(3);
  });

  it("leaves the rescan to the next read when no list is mounted", async () => {
    bindings.unitsyncScan.mockImplementation(async () => scanOf("A"));
    await primeScan(ENGINE, dir);

    bindings.unitsyncScan.mockImplementation(async () => scanOf("A", "B"));
    invalidateScans();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bindings.unitsyncScan).toHaveBeenCalledTimes(1);

    expect((await primeScan(ENGINE, dir)).maps).toHaveLength(2);
    expect(bindings.unitsyncScan).toHaveBeenCalledTimes(2);
  });
});

describe("the other caches a change clears", () => {
  it("reads the installed file listing again after the scans are forgotten", async () => {
    await installedContent({ paths: [dir] });
    await installedContent({ paths: [dir] });
    expect(dlInstalledContent).toHaveBeenCalledTimes(1);

    forgetScans();
    await installedContent({ paths: [dir] });
    expect(dlInstalledContent).toHaveBeenCalledTimes(2);
  });

  it("reads the installed file listing again after a forced scan", async () => {
    bindings.unitsyncScan.mockImplementation(async () => scanOf("A"));
    await installedContent({ paths: [dir] });
    await primeScan(ENGINE, dir, true);
    await installedContent({ paths: [dir] });
    expect(dlInstalledContent).toHaveBeenCalledTimes(2);
  });

  it("saves the fresh scan as the last known one and replaces the scan hints", async () => {
    const { page, setDisk } = await mountedOn("A", "B");
    expect((await readLastScan(ENGINE, dir))?.maps).toHaveLength(2);

    setDisk("A");
    act(() => invalidateScans(true));
    await waitFor(() =>
      expect(page.result.current.scan.data?.maps).toHaveLength(1),
    );

    expect((await readLastScan(ENGINE, dir))?.maps).toHaveLength(1);
    expect(bindings.unitsyncLastScanWrite).toHaveBeenCalledTimes(2);
    expect(mapInScan(dir, ENGINE, "A")).toBe(true);
    expect(mapInScan(dir, ENGINE, "B")).toBe(false);
  });
});
