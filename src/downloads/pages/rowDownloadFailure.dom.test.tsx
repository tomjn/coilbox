// @vitest-environment happy-dom

/**
 * What the Games and Maps download pages say about a download that failed
 * (issue #1863).
 *
 * Both pages put a Download button on every row and read the queue for that
 * row's progress, and neither used to read why an attempt failed. A failed row
 * went back to offering the download and said nothing, while a notification
 * elsewhere said a download had failed, so the page the button was pressed on
 * and the notification disagreed.
 *
 * These tests fail a real queued download and then look at the row that started
 * it. The message has to outlive the queue pruning the row it came from, which
 * is why the assertion is on the page rather than on the queue item.
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "../DownloadQueueProvider";
import GamesPage from "./GamesPage";
import MapsPage from "./MapsPage";

const downloadFile = vi.hoisted(() => vi.fn(async () => ({})));
const downloadMap = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("../bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: downloadFile,
  dlDownloadMap: downloadMap,
  dlGithubReleaseArchives: vi.fn(async () => ({ archives: [] })),
  dlHakoraMaps: vi.fn(async () => ({ maps: [] })),
  dlInstalledContent: vi.fn(async () => ({ maps: [], games: [] })),
  dlSpringfilesList: vi.fn(async ({ category }: { category: string }) => ({
    results: [
      category === "game"
        ? {
            springname: "Advanced BA 1.63",
            name: "Advanced BA",
            filename: "advanced_ba-1.63.sd7",
            category: "game",
            size: 1024,
            mirrors: ["https://example.invalid/advanced_ba-1.63.sd7"],
            mapimages: [],
            metadata: { author: "", width: 0, height: 0 },
          }
        : {
            springname: "Isis",
            name: "Isis",
            filename: "isis.sd7",
            category: "map",
            size: 1024,
            mirrors: [],
            mapimages: [],
            metadata: { author: "someone", width: 12, height: 12 },
          },
    ],
  })),
}));

vi.mock("../config", () => ({
  useWriteRoot: () => ({ path: "/content", loading: false }),
  useContentRootPaths: () => ["/content"],
}));

vi.mock("../downloadGame", () => ({ downloadGameAnySource: vi.fn() }));
vi.mock("../downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../../content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("../../content/config", () => ({ invalidateScans: vi.fn() }));
vi.mock("../../content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

vi.mock("@/content/branding", () => ({
  useGithubGameRepos: () => [],
  useSuggestedMapLists: () => [],
  useCachedImage: () => ({ src: undefined, loading: false }),
}));

// The banner is a screen of its own above the grid, with its own downloads. What
// a row says about its own failure is not its business.
vi.mock("./components/MapPacksBanner", () => ({
  MapPacksBanner: () => null,
}));

vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: undefined, hubItemId: undefined }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../../play/presets", () => ({ presetRoute: () => "/" }));

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  useSetting: () => [false, vi.fn()],
  useDrawer: () => ({ open: vi.fn(), close: vi.fn() }),
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
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

/** Press the row's Download button once the list has arrived. */
async function pressDownload(name: RegExp) {
  const button = await screen.findByRole("button", { name });
  button.click();
}

describe("a download started from the Games page", () => {
  it("says on the row why it failed", async () => {
    downloadFile.mockRejectedValueOnce(new Error("the mirror refused it"));
    render(
      <DownloadQueueProvider>
        <GamesPage />
      </DownloadQueueProvider>,
    );

    await pressDownload(/Download Advanced BA/);

    await waitFor(() =>
      expect(screen.getByText("the mirror refused it")).toBeTruthy(),
    );
  });

  it("says nothing about a download that has not been tried", async () => {
    render(
      <DownloadQueueProvider>
        <GamesPage />
      </DownloadQueueProvider>,
    );

    await screen.findByRole("button", { name: /Download Advanced BA/ });
    expect(screen.queryByText("the mirror refused it")).toBeNull();
  });
});

describe("a download started from the Maps page", () => {
  it("says on the row why it failed", async () => {
    downloadMap.mockRejectedValueOnce(new Error("no mirror had it"));
    render(
      <DownloadQueueProvider>
        <MapsPage />
      </DownloadQueueProvider>,
    );

    await pressDownload(/Download Isis/);

    await waitFor(() =>
      expect(screen.getByText("no mirror had it")).toBeTruthy(),
    );
  });

  it("keeps saying so once the queue has pruned the row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      downloadMap.mockRejectedValueOnce(new Error("no mirror had it"));
      render(
        <DownloadQueueProvider>
          <MapsPage />
        </DownloadQueueProvider>,
      );

      await pressDownload(/Download Isis/);
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
