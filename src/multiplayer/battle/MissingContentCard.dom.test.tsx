// @vitest-environment happy-dom

/**
 * The missing-game card's failure message has to survive the download queue
 * pruning the row it came from, the same guarantee `useQueuedDownload` already
 * gives `MissingMapBox` (issue #1860). This card read the queue item's `error`
 * directly instead of going through `failureFor`, so a few seconds after a
 * failed download the row was gone and the card fell back to a bare "not
 * installed" with no reason (issue #2504).
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "@/downloads/DownloadQueueProvider";
import { MissingContentCard } from "./MissingContentCard";

const downloadGameAnySource = vi.hoisted(() => vi.fn());

vi.mock("@/downloads/bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
}));
vi.mock("@/downloads/downloadGame", () => ({ downloadGameAnySource }));
vi.mock("@/downloads/downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("@/content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("@/content/config", () => ({ invalidateScans: vi.fn() }));
vi.mock("@/content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

vi.mock("@/downloads/config", () => ({ useWriteRootPath: () => "/content" }));

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  useSetting: () => [false, vi.fn()],
}));

beforeEach(() => {
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = { transformCallback: (cb: unknown) => cb };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the missing-game card", () => {
  it("says why the download failed", async () => {
    downloadGameAnySource.mockRejectedValueOnce(new Error("no mirror had it"));
    render(
      <DownloadQueueProvider>
        <MissingContentCard
          battleId={1}
          gameName="Beyond All Reason"
          onRescan={async () => {}}
        />
      </DownloadQueueProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "Download" }).click();
    });

    await waitFor(() =>
      expect(screen.getByText("no mirror had it")).toBeTruthy(),
    );
  });

  it("keeps saying why once the queue has pruned the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      downloadGameAnySource.mockRejectedValueOnce(
        new Error("no mirror had it"),
      );
      render(
        <DownloadQueueProvider>
          <MissingContentCard
            battleId={1}
            gameName="Beyond All Reason"
            onRescan={async () => {}}
          />
        </DownloadQueueProvider>,
      );

      act(() => {
        screen.getByRole("button", { name: "Download" }).click();
      });

      await waitFor(() =>
        expect(screen.getByText("no mirror had it")).toBeTruthy(),
      );

      // Comfortably past the queue's four second prune.
      await vi.advanceTimersByTimeAsync(10_000);

      expect(screen.getByText("no mirror had it")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
