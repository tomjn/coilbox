// @vitest-environment happy-dom

/**
 * The download queue, the scan cache and `useResolveContent` together, with
 * only the backend commands stubbed (issue #3721).
 *
 * The queue's own tests count calls to a stubbed `config`, which cannot show
 * whether a finished download reaches a scan. These count the scans.
 *
 * Every test uses its own target, because a finished scan is remembered.
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanResult } from "./bindings";

/** One fake download held open, by the command that started it. */
interface Open {
  command: string;
  finish: () => void;
  fail: (message: string) => void;
}
const open: Open[] = vi.hoisted(() => []);
const unitsyncScan = vi.hoisted(() => vi.fn());

vi.mock("../downloads/bindings", () => {
  const download = (command: string) =>
    vi.fn(
      () =>
        new Promise<{ message: string }>((resolve, reject) => {
          open.push({
            command,
            finish: () => resolve({ message: "ok" }),
            fail: (message) => reject(new Error(message)),
          });
        }),
    );
  return {
    dlCancel: vi.fn(async () => ({})),
    dlDownload: download("rapid"),
    dlDownloadEngineRecoil: download("engineRecoil"),
    dlDownloadEngineSpring: download("engineSpring"),
    dlDownloadFile: download("file"),
    dlDownloadMap: download("map"),
    dlInstalledContent: vi.fn(async () => ({ maps: [], games: [] })),
    dlRecoilEngines: vi.fn(async () => ({ releases: [] })),
    dlSpringfilesEngines: vi.fn(async () => ({ engines: [] })),
  };
});
vi.mock("../downloads/downloadGame", () => ({
  downloadGameAnySource: vi.fn(),
}));
vi.mock("../downloads/downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../downloads/warmEngineCache", () => ({
  installEngine: vi.fn(async (download: () => Promise<unknown>) => {
    await download();
  }),
}));
vi.mock("../downloads/config", () => ({
  useWriteRoot: () => ({ path: "/content", loading: false }),
}));
vi.mock("./rapidPoolWarm", () => ({ warmAllRoots: vi.fn(async () => {}) }));
vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  unitsyncScan,
  unitsyncCancel: vi.fn(async () => ({})),
  unitsyncLastScanWrite: vi.fn(async () => null),
  contentStateLoad: vi.fn(async () => ({ roots: [] })),
  contentBundleInstallEngine: vi.fn(),
  contentBundleCancel: vi.fn(),
}));

const { DownloadQueueProvider, useDownloadQueue } = await import(
  "../downloads/DownloadQueueProvider"
);
const { useUnitsyncScan } = await import("./config");
const { exactGameRequirement } = await import("./resolveContent");
const { useResolveContent } = await import("./useResolveContent");

const ENGINE = "/engine";
let n = 0;
let dir = "";

const wrapper = ({ children }: { children: ReactNode }) => (
  <DownloadQueueProvider>{children}</DownloadQueueProvider>
);

function scanOf(maps: string[], games: string[] = []): ScanResult {
  return {
    maps: maps.map((name) => ({ name, archives: [], info: {} })),
    games: games.map((name) => ({
      name,
      primaryArchive: { name: `${name}.sdz`, path: `/games/${name}.sdz` },
      dependencyArchives: [],
      info: {},
    })),
    errors: [],
  };
}

/** A promise the test settles by hand. */
function held<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Wait for the queue to start the nth download. */
async function nextOpen(index: number): Promise<Open> {
  await waitFor(() => expect(open.length).toBeGreaterThan(index));
  const o = open[index];
  if (!o) throw new Error(`no download at ${index}`);
  return o;
}

const mapRequest = (springName: string) =>
  ({ kind: "map", label: `Map: ${springName}`, args: { springName } }) as const;

const gameFileRequest = {
  kind: "file",
  label: "Game: SplinterFaction",
  args: {
    url: "https://example.test/sf.sdz",
    destDir: "/content/games",
    filename: "sf.sdz",
  },
} as const;

beforeEach(() => {
  open.length = 0;
  unitsyncScan.mockReset();
  n += 1;
  dir = `/queue-${n}`;
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = { transformCallback: (cb: unknown) => cb };
});

afterEach(cleanup);

describe("a content card waiting on a download", () => {
  const requirement = exactGameRequirement("Game 1.0");
  const useCard = () => ({
    card: useResolveContent(
      [requirement],
      { enginePath: ENGINE, dataDir: dir },
      false,
    ),
    queue: useDownloadQueue(),
  });

  it("clears when a rapid download finishes", async () => {
    unitsyncScan.mockImplementation(async () => scanOf(["A"]));
    const { result } = renderHook(useCard, { wrapper });
    await waitFor(() => expect(result.current.card.missing).toHaveLength(1));
    expect(unitsyncScan).toHaveBeenCalledTimes(1);

    unitsyncScan.mockImplementation(async () => scanOf(["A"], ["Game 1.0"]));
    act(() => {
      result.current.queue.enqueue({
        kind: "rapid",
        label: "Game 1.0",
        args: { tag: "game:stable", writePath: "/content" },
      });
    });
    const download = await nextOpen(0);
    await act(async () => {
      download.finish();
    });

    await waitFor(() => expect(result.current.card.resolved).toBe(true));
    expect(unitsyncScan).toHaveBeenCalledTimes(2);
  });

  it("scans again after an engine install when its scan had failed", async () => {
    unitsyncScan.mockRejectedValue(new Error("libunitsync not found"));
    const { result } = renderHook(useCard, { wrapper });
    await waitFor(() => expect(result.current.card.unreadable).toBe(true));
    expect(unitsyncScan).toHaveBeenCalledTimes(1);

    unitsyncScan.mockImplementation(async () => scanOf(["A"], ["Game 1.0"]));
    act(() => {
      result.current.queue.enqueue({
        kind: "engineRecoil",
        label: "Engine 2026.07.01",
        args: {
          version: "2026.07.01",
          assetUrl: "https://example.test/engine.7z",
          writePath: "/content",
        },
      });
    });
    const download = await nextOpen(0);
    await act(async () => {
      download.finish();
    });

    await waitFor(() => expect(result.current.card.resolved).toBe(true));
    expect(unitsyncScan).toHaveBeenCalledTimes(2);
  });
});

describe("a list on screen while the queue runs", () => {
  const useList = () => ({
    scan: useUnitsyncScan(ENGINE, dir),
    queue: useDownloadQueue(),
  });

  it("costs one scan for one finished download", async () => {
    unitsyncScan.mockImplementation(async () => scanOf(["A"]));
    const { result } = renderHook(useList, { wrapper });
    await waitFor(() => expect(result.current.scan.data).not.toBeNull());

    let settled = false;
    act(() => {
      const id = result.current.queue.enqueue(mapRequest("B"));
      void result.current.queue.waitFor(id).then(() => {
        settled = true;
      });
    });
    const download = await nextOpen(0);
    unitsyncScan.mockImplementation(async () => scanOf(["A", "B"]));
    await act(async () => {
      download.finish();
    });

    // A screen that started the download and waited for it has nothing to
    // forget: the queue did, and the rescan is already the fresh one.
    await waitFor(() => expect(settled).toBe(true));
    await waitFor(() => expect(result.current.scan.data?.maps).toHaveLength(2));
    expect(result.current.scan.loading).toBe(false);
    expect(unitsyncScan).toHaveBeenCalledTimes(2);
  });

  it("rescans when the last of a lane is cancelled while still queued", async () => {
    unitsyncScan.mockImplementation(async () => scanOf(["A"]));
    const { result } = renderHook(useList, { wrapper });
    await waitFor(() => expect(result.current.scan.data).not.toBeNull());

    let second = "";
    act(() => {
      result.current.queue.enqueue(mapRequest("B"));
      second = result.current.queue.enqueue(mapRequest("C"));
    });
    const first = await nextOpen(0);
    unitsyncScan.mockImplementation(async () => scanOf(["A", "B"]));

    // B finishes and, before the queue has started C, C is cancelled. Nothing
    // rescanned for B because C was still to come.
    await act(async () => {
      first.finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unitsyncScan).toHaveBeenCalledTimes(1);
      result.current.queue.cancel(second);
    });

    await waitFor(() => expect(result.current.scan.data?.maps).toHaveLength(2));
    expect(unitsyncScan).toHaveBeenCalledTimes(2);
    expect(open).toHaveLength(1);
  });

  it("ends with both when the maps and games lanes finish together", async () => {
    unitsyncScan.mockImplementation(async () => scanOf(["A"]));
    const { result } = renderHook(useList, { wrapper });
    await waitFor(() => expect(result.current.scan.data).not.toBeNull());

    act(() => {
      result.current.queue.enqueue(mapRequest("B"));
      result.current.queue.enqueue(gameFileRequest);
    });
    const map = await nextOpen(0);
    const game = await nextOpen(1);

    // The rescan for the map is still listing folders when the game lands.
    const running = held<ScanResult>();
    unitsyncScan.mockImplementationOnce(() => running.promise);
    unitsyncScan.mockImplementation(async () =>
      scanOf(["A", "B"], ["SplinterFaction"]),
    );
    await act(async () => {
      map.finish();
    });
    await waitFor(() => expect(unitsyncScan).toHaveBeenCalledTimes(2));
    await act(async () => {
      game.finish();
    });
    await act(async () => {
      running.resolve(scanOf(["A", "B"]));
      await running.promise;
    });

    await waitFor(() =>
      expect(result.current.scan.data?.games).toHaveLength(1),
    );
    expect(result.current.scan.data?.maps).toHaveLength(2);
    // The first scan, the one the game overtook, and one more.
    expect(unitsyncScan).toHaveBeenCalledTimes(3);
  });
});
