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
import {
  DownloadQueueProvider,
  useDownloadQueue,
} from "./DownloadQueueProvider";
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
vi.mock("../content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
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

/**
 * The rate estimator itself is tested in `downloadRate.test.ts`. These cover
 * the wiring: a screen reads speed and time left off the queue item, computed
 * from the events that download's own source actually sent (issue #1726).
 */
describe("the queue's speed estimate", () => {
  /** Feed `count` events a second apart, on a clock the test controls. */
  function stream(
    run: Pending,
    count: number,
    at: (i: number) => DownloadProgress,
  ) {
    const clock = vi.spyOn(Date, "now");
    for (let i = 0; i < count; i++) {
      clock.mockReturnValue(1_000_000 + i * 1000);
      act(() => run.progress(at(i)));
    }
    clock.mockRestore();
  }

  it("reads a speed and a time left off an HTTP download's byte counts", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const run = await nextPending(0);

    // 1 MB/s against a 10 MB total, so five seconds in there are five to go.
    stream(run, 6, (i) => ({
      phase: "downloading",
      downloadedBytes: i * 1_000_000,
      totalBytes: 10_000_000,
      percent: i * 10,
      bytesPerSec: null,
    }));

    expect(result.current.active?.rate.bytesPerSec).toBeCloseTo(1_000_000, -1);
    expect(result.current.active?.rate.secondsLeft).toBe(5);
    expect(result.current.active?.rate.stalled).toBe(false);
  });

  it("still finds a time left when the source only reports a percentage", async () => {
    // pr-downloader's usual output: a percentage, no byte counts and no rate.
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const run = await nextPending(0);

    stream(run, 5, (i) => ({
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      percent: i * 10,
      bytesPerSec: null,
    }));

    expect(result.current.active?.rate.bytesPerSec).toBeNull();
    expect(result.current.active?.rate.secondsLeft).toBe(6);
  });

  it("gives a fresh download no rate to read yet", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const run = await nextPending(0);

    stream(run, 1, () => ({
      phase: "downloading",
      downloadedBytes: 1024,
      totalBytes: 10_000_000,
      percent: 0.01,
      bytesPerSec: null,
    }));

    expect(result.current.active?.rate.bytesPerSec).toBeNull();
    expect(result.current.active?.rate.secondsLeft).toBeNull();
    expect(result.current.active?.startedAt).not.toBeNull();
  });
});

/**
 * A download the queue does not run but the indicator should still show: the
 * app updater fetching its own installer (issue #1790). It must not take a
 * queue slot, because an app update waiting behind a map is the wrong answer,
 * and it must still get the same speed and time left as everything else.
 */
describe("a download reported from outside the queue", () => {
  const bytes = (downloadedBytes: number): DownloadProgress => ({
    phase: "downloading",
    downloadedBytes,
    totalBytes: 10_000_000,
    percent: downloadedBytes / 100_000,
    bytesPerSec: null,
  });

  it("shows in the indicator without taking the running slot", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    act(() => {
      result.current.enqueue(mapRequest("Isis"));
      result.current.report("app-update", {
        label: "Coilbox 1.2.3",
        progress: bytes(0),
      });
    });

    await waitFor(() => expect(result.current.active?.label).toBe("Map: Isis"));
    expect(result.current.reported.map((r) => r.label)).toEqual([
      "Coilbox 1.2.3",
    ]);
    expect(result.current.queued).toHaveLength(0);
    // The map still ran: a reported download waits for nothing and blocks
    // nothing.
    expect(pending).toHaveLength(1);
  });

  it("estimates its speed and time left the same way the queue does", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    const clock = vi.spyOn(Date, "now");
    for (let i = 0; i < 6; i++) {
      clock.mockReturnValue(1_000_000 + i * 1000);
      act(() => {
        result.current.report("app-update", {
          label: "Coilbox 1.2.3",
          progress: bytes(i * 1_000_000),
        });
      });
    }
    clock.mockRestore();

    const item = result.current.reported[0];
    expect(item.rate.bytesPerSec).toBeCloseTo(1_000_000, -1);
    expect(item.rate.secondsLeft).toBe(5);
    expect(item.startedAt).toBe(1_000_000);
  });

  it("drops out of the indicator when the reporter says it is over", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    act(() => {
      result.current.report("app-update", {
        label: "Coilbox 1.2.3",
        progress: bytes(0),
      });
    });
    expect(result.current.reported).toHaveLength(1);

    act(() => {
      result.current.report("app-update", null);
    });
    expect(result.current.reported).toHaveLength(0);
  });
});
