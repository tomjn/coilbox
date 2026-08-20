// @vitest-environment happy-dom

/**
 * What a download has to do to reach the topbar download indicator, driven
 * rather than read.
 *
 * The indicator (`DownloadQueueBadge`) shows exactly what the queue calls
 * active or queued, so a screen that calls a `dl*` binding itself never appears
 * there however long it runs (issue #1725). These tests cover the path a screen
 * now takes instead: put the request on the queue, watch it from there, and
 * still find out when it finished.
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadProgress } from "./bindings";
import { DownloadQueueProvider, useDownloadQueue } from "./DownloadQueueProvider";
import { useQueuedDownload } from "./useQueuedDownload";

/** One in-flight fake download, held open so a test can drive it. */
interface Pending {
  springName: string;
  progress: (p: DownloadProgress) => void;
  finish: () => void;
  fail: (message: string) => void;
}

const pending: Pending[] = [];

vi.mock("./bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(
    (args: {
      springName: string;
      onProgress: { onmessage: (p: DownloadProgress) => void };
    }) =>
      new Promise<{ message: string }>((resolve, reject) => {
        pending.push({
          springName: args.springName,
          progress: (p) => args.onProgress.onmessage(p),
          finish: () => resolve({ message: "ok" }),
          fail: (message) => reject(new Error(message)),
        });
      }),
  ),
}));

vi.mock("./downloadGame", () => ({ downloadGameAnySource: vi.fn() }));
vi.mock("./downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../content/bindings", () => ({ contentRescan: vi.fn(async () => {}) }));
vi.mock("../content/config", () => ({ invalidateScans: vi.fn() }));
vi.mock("../content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <DownloadQueueProvider>{children}</DownloadQueueProvider>
);

const mapRequest = (springName: string) =>
  ({
    kind: "map",
    label: `Map: ${springName}`,
    args: { springName },
  }) as const;

/** Wait for the queue to hand the fake binding the nth download. */
async function nextPending(index: number): Promise<Pending> {
  await waitFor(() => expect(pending.length).toBeGreaterThan(index));
  const p = pending[index];
  if (!p) throw new Error(`no pending download at ${index}`);
  return p;
}

beforeEach(() => {
  pending.length = 0;
  // `Channel` asks Tauri for a callback id the moment it is constructed, and
  // there is no Tauri behind a test. The queue only ever reads messages back
  // out of the channel it made, so an identity function is enough.
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = {
    transformCallback: (cb: unknown) => cb,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the download queue", () => {
  it("shows an enqueued download to the indicator", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });

    await waitFor(() => expect(result.current.active?.label).toBe("Map: Isis"));
    expect(result.current.queued).toHaveLength(0);
  });

  it("queues a second download behind the first rather than running both", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    act(() => {
      result.current.enqueue(mapRequest("Isis"));
      result.current.enqueue(mapRequest("Comet Catcher"));
    });

    await waitFor(() => expect(result.current.active?.label).toBe("Map: Isis"));
    expect(result.current.queued.map((i) => i.label)).toEqual([
      "Map: Comet Catcher",
    ]);
    expect(pending).toHaveLength(1);
  });

  it("hands back the running download's id when asked for the same one twice", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    let first = "";
    let second = "";
    act(() => {
      first = result.current.enqueue(mapRequest("Isis"));
      second = result.current.enqueue(mapRequest("Isis"));
    });

    expect(second).toBe(first);
    await waitFor(() => expect(result.current.active).not.toBeNull());
    expect(result.current.queued).toHaveLength(0);
  });

  it("reports progress against the running download", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const run = await nextPending(0);

    act(() => {
      run.progress({
        phase: "downloading",
        downloadedBytes: 512,
        totalBytes: 1024,
        percent: 50,
        bytesPerSec: null,
      });
    });

    await waitFor(() =>
      expect(result.current.active?.progress?.percent).toBe(50),
    );
  });

  it("settles a waiter when the download finishes", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    let settled: { status: string } | null = null;
    act(() => {
      const id = result.current.enqueue(mapRequest("Isis"));
      void result.current.waitFor(id).then((i) => {
        settled = i;
      });
    });

    const run = await nextPending(0);
    await act(async () => {
      run.finish();
    });

    await waitFor(() => expect(settled).not.toBeNull());
    expect(settled).toMatchObject({ status: "done" });
  });

  it("settles a waiter with the reason when the download fails", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    let settled: { status: string; error: string | null } | null = null;
    act(() => {
      const id = result.current.enqueue(mapRequest("Isis"));
      void result.current.waitFor(id).then((i) => {
        settled = i;
      });
    });

    const run = await nextPending(0);
    await act(async () => {
      run.fail("no mirror had it");
    });

    await waitFor(() => expect(settled).not.toBeNull());
    expect(settled).toMatchObject({
      status: "error",
      error: "no mirror had it",
    });
  });

  it("settles a waiter for a download dropped from the queue before it ran", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    let settled: { status: string } | null = null;
    let secondId = "";
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
      secondId = result.current.enqueue(mapRequest("Comet Catcher"));
      void result.current.waitFor(secondId).then((i) => {
        settled = i;
      });
    });

    await waitFor(() => expect(result.current.queued).toHaveLength(1));
    act(() => {
      result.current.cancel(secondId);
    });

    await waitFor(() => expect(settled).not.toBeNull());
    expect(settled).toMatchObject({ status: "canceled" });
    expect(result.current.queued).toHaveLength(0);
  });

  it("answers straight away for an id it has never held", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    await expect(result.current.waitFor("not-a-download")).resolves.toBeNull();
  });
});

describe("a screen's download", () => {
  it("goes on the queue, so the indicator shows it", async () => {
    const { result } = renderHook(
      () => ({
        screen: useQueuedDownload(mapRequest("Isis")),
        queue: useDownloadQueue(),
      }),
      { wrapper },
    );

    act(() => {
      void result.current.screen.start();
    });

    await waitFor(() =>
      expect(result.current.queue.active?.label).toBe("Map: Isis"),
    );
    expect(result.current.screen.busy).toBe(true);
  });

  it("reads its own progress and outcome back off the queue", async () => {
    const { result } = renderHook(() => useQueuedDownload(mapRequest("Isis")), {
      wrapper,
    });

    let settled: { status: string } | null = null;
    act(() => {
      void result.current.start().then((i) => {
        settled = i;
      });
    });

    const run = await nextPending(0);
    act(() => {
      run.progress({
        phase: "downloading",
        downloadedBytes: 256,
        totalBytes: 1024,
        percent: 25,
        bytesPerSec: null,
      });
    });
    await waitFor(() => expect(result.current.progress?.percent).toBe(25));

    await act(async () => {
      run.finish();
    });
    await waitFor(() => expect(settled).toMatchObject({ status: "done" }));
    expect(result.current.busy).toBe(false);
  });

  it("shows a download for the same map started elsewhere as busy", async () => {
    const { result } = renderHook(
      () => ({
        screen: useQueuedDownload(mapRequest("Isis")),
        queue: useDownloadQueue(),
      }),
      { wrapper },
    );

    act(() => {
      result.current.queue.enqueue(mapRequest("Isis"));
    });

    await waitFor(() => expect(result.current.screen.busy).toBe(true));
  });

  it("takes a request built at click time", async () => {
    const { result } = renderHook(
      () => ({ screen: useQueuedDownload(), queue: useDownloadQueue() }),
      { wrapper },
    );

    act(() => {
      void result.current.screen.start(mapRequest("Comet Catcher"));
    });

    await waitFor(() =>
      expect(result.current.queue.active?.label).toBe("Map: Comet Catcher"),
    );
    expect(result.current.screen.busy).toBe(true);
  });

  it("does nothing when there is no request to make", async () => {
    const { result } = renderHook(() => useQueuedDownload(null), { wrapper });
    await expect(result.current.start()).resolves.toBeNull();
    expect(pending).toHaveLength(0);
  });
});
