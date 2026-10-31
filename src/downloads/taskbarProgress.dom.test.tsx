// @vitest-environment happy-dom

/**
 * The taskbar or dock progress bar as the queue drives it (issue #359): what
 * reaches `setProgressBar` as downloads start, move, fail and stop.
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DownloadProgress, dlDownloadMap } from "./bindings";
import {
  DownloadQueueProvider,
  useDownloadQueue,
} from "./DownloadQueueProvider";

interface Pending {
  springName: string;
  progress: (p: DownloadProgress) => void;
  finish: () => void;
  fail: (message: string) => void;
}

const pending: Pending[] = [];

const { setProgressBar } = vi.hoisted(() => ({
  setProgressBar: vi.fn(async (_state: unknown) => {}),
}));

vi.mock("@tauri-apps/api/window", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/window")>()),
  getCurrentWindow: () => ({ setProgressBar }),
}));

vi.mock("./bindings", () => {
  const start = (args: {
    springName?: string;
    filename?: string;
    onProgress: { onmessage: (p: DownloadProgress) => void };
  }) =>
    new Promise<{ message: string }>((resolve, reject) => {
      pending.push({
        springName: args.springName ?? args.filename ?? "",
        progress: (p) => args.onProgress.onmessage(p),
        finish: () => resolve({ message: "ok" }),
        fail: (message) => reject(new Error(message)),
      });
    });
  return {
    dlCancel: vi.fn(async () => ({})),
    dlDownload: vi.fn(),
    dlDownloadEngineRecoil: vi.fn(),
    dlDownloadEngineSpring: vi.fn(),
    dlDownloadFile: vi.fn(start),
    dlDownloadMap: vi.fn(start),
  };
});

vi.mock("./warmEngineCache", () => ({ installEngine: vi.fn() }));
vi.mock("./downloadGame", () => ({ downloadGameAnySource: vi.fn() }));
vi.mock("./downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../content/bindings", () => ({ contentRescan: vi.fn() }));
vi.mock("../content/config", () => ({
  forgetScans: vi.fn(),
  invalidateScans: vi.fn(),
  rescanMounted: vi.fn(),
}));
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

// A map and a file run side by side, because each kind has a lane of its own.
const fileRequest = (filename: string) =>
  ({
    kind: "file",
    label: `File: ${filename}`,
    args: { url: "https://example.invalid/f", destDir: "/tmp/x", filename },
  }) as const;

const percent = (percent: number | null): DownloadProgress => ({
  phase: "downloading",
  downloadedBytes: 1,
  totalBytes: percent == null ? null : 100,
  percent,
  bytesPerSec: null,
});

async function nextPending(index: number): Promise<Pending> {
  await waitFor(() => expect(pending.length).toBeGreaterThan(index));
  const p = pending[index];
  if (!p) throw new Error(`no pending download at ${index}`);
  return p;
}

const lastCall = () => setProgressBar.mock.calls.at(-1)?.[0];

beforeEach(() => {
  pending.length = 0;
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = { transformCallback: (cb: unknown) => cb };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("taskbar progress", () => {
  it("never sets the progress bar while there are no downloads", async () => {
    renderHook(() => useDownloadQueue(), { wrapper });
    await act(async () => {});
    expect(setProgressBar).not.toHaveBeenCalled();
  });

  it("follows a download as it runs, then clears when it finishes", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const one = await nextPending(0);

    act(() => one.progress(percent(25)));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "normal", progress: 25 }),
    );
    act(() => one.progress(percent(75)));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "normal", progress: 75 }),
    );

    act(() => one.finish());
    await waitFor(() => expect(lastCall()).toEqual({ status: "none" }));
  });

  it("shows one combined figure for downloads running together", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
      result.current.enqueue(fileRequest("a.sdz"));
    });
    const map = await nextPending(0);
    const file = await nextPending(1);

    act(() => map.progress(percent(20)));
    act(() => file.progress(percent(60)));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "normal", progress: 40 }),
    );

    // One with no percentage stays out of the mean.
    act(() => file.progress(percent(null)));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "normal", progress: 20 }),
    );
  });

  it("is indeterminate while no running download has a percentage", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const one = await nextPending(0);
    act(() => one.progress(percent(null)));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "indeterminate" }),
    );
  });

  it("clears when the only download is cancelled", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    let id = "";
    act(() => {
      id = result.current.enqueue(mapRequest("Isis"));
    });
    const one = await nextPending(0);
    act(() => one.progress(percent(10)));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "normal", progress: 10 }),
    );

    act(() => result.current.cancel(id));
    act(() => one.fail("cancelled"));
    await waitFor(() => expect(lastCall()).toEqual({ status: "none" }));
  });

  it("shows the error state after a failure until the queue is opened", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const one = await nextPending(0);
    act(() => one.fail("connection reset"));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "error", progress: 100 }),
    );

    act(() => result.current.acknowledgeFailures());
    await waitFor(() => expect(lastCall()).toEqual({ status: "none" }));
  });

  it("ends the error state when the next download starts", async () => {
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const one = await nextPending(0);
    act(() => one.fail("connection reset"));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "error", progress: 100 }),
    );

    act(() => {
      result.current.enqueue(mapRequest("Comet"));
    });
    const two = await nextPending(1);
    act(() => two.progress(percent(30)));
    await waitFor(() =>
      expect(lastCall()).toEqual({ status: "normal", progress: 30 }),
    );
    act(() => two.finish());
    await waitFor(() => expect(lastCall()).toEqual({ status: "none" }));
  });

  it("logs a rejected setProgressBar and carries on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setProgressBar.mockRejectedValue(new Error("not supported"));
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });
    act(() => {
      result.current.enqueue(mapRequest("Isis"));
    });
    const one = await nextPending(0);
    act(() => one.progress(percent(50)));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(dlDownloadMap).toHaveBeenCalled();
    warn.mockRestore();
    setProgressBar.mockResolvedValue(undefined);
  });
});
