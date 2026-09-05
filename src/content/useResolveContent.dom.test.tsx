// @vitest-environment happy-dom

/**
 * The resolve drawer's failure message has to survive the download queue
 * pruning the row it came from, the same guarantee `useQueuedDownload` already
 * gives `MissingMapBox` (issue #1860). `errorFor` read the queue item's `error`
 * directly instead of going through `failureFor`, so a few seconds after a
 * failed download the row was gone and the drawer stopped saying why (issue
 * #2504).
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DownloadQueueProvider,
  useDownloadQueue,
} from "../downloads/DownloadQueueProvider";
import { exactGameRequirement } from "./resolveContent";
import { useResolveContent } from "./useResolveContent";

const downloadGameAnySource = vi.hoisted(() => vi.fn());
const { installEngine } = vi.hoisted(() => ({
  installEngine: vi.fn(async (download: () => Promise<unknown>) => {
    await download();
  }),
}));

vi.mock("../downloads/bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
  dlRecoilEngines: vi.fn(async () => ({ releases: [] })),
  dlSpringfilesEngines: vi.fn(async () => ({ engines: [] })),
}));
vi.mock("../downloads/downloadGame", () => ({ downloadGameAnySource }));
vi.mock("../downloads/downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../downloads/warmEngineCache", () => ({ installEngine }));
vi.mock("../downloads/config", () => ({
  useWriteRoot: () => ({ path: "/content", loading: false }),
}));

vi.mock("./config", () => ({
  useContentTargets: () => ({
    targets: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
  useUnitsyncScan: () => ({
    data: null,
    loading: false,
    error: null,
    cancelled: false,
    run: vi.fn(),
  }),
  invalidateScans: vi.fn(),
}));
vi.mock("./rapidPoolWarm", () => ({ warmAllRoots: vi.fn(async () => {}) }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <DownloadQueueProvider>{children}</DownloadQueueProvider>
);

beforeEach(() => {
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = { transformCallback: (cb: unknown) => cb };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useResolveContent's errorFor", () => {
  const requirement = exactGameRequirement("Beyond All Reason");

  it("says why the download failed", async () => {
    downloadGameAnySource.mockRejectedValueOnce(new Error("no mirror had it"));
    const { result } = renderHook(
      () => useResolveContent([requirement], undefined, false),
      { wrapper },
    );

    act(() => {
      result.current.download(requirement);
    });

    await waitFor(() =>
      expect(result.current.errorFor(requirement)).toBe("no mirror had it"),
    );
  });

  it("keeps saying why once the queue has pruned the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      downloadGameAnySource.mockRejectedValueOnce(
        new Error("no mirror had it"),
      );
      const { result } = renderHook(
        () => ({
          resolve: useResolveContent([requirement], undefined, false),
          queue: useDownloadQueue(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.resolve.download(requirement);
      });

      await waitFor(() =>
        expect(result.current.resolve.errorFor(requirement)).toBe(
          "no mirror had it",
        ),
      );

      // Comfortably past the queue's four second prune.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(result.current.queue.items).toHaveLength(0);
      expect(result.current.resolve.errorFor(requirement)).toBe(
        "no mirror had it",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
