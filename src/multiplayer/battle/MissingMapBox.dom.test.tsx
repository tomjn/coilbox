// @vitest-environment happy-dom

/**
 * The missing-map box has to tell a download that worked from one that has not
 * happened. A player whose map landed in a folder the engine was not reading
 * was offered the same download again, with a "Download complete" toast still
 * on screen. It also looks again before fetching on join, so a map already on
 * disk is not downloaded a second time.
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "@/downloads/DownloadQueueProvider";
import { MissingMapBox } from "./MissingMapBox";

const downloadMapAnySource = vi.hoisted(() => vi.fn());
const autoDownload = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/downloads/bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
}));
vi.mock("@/downloads/downloadGame", () => ({ downloadGameAnySource: vi.fn() }));
vi.mock("@/downloads/downloadMap", () => ({ downloadMapAnySource }));
vi.mock("@/content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("@/content/config", () => ({ invalidateScans: vi.fn() }));
vi.mock("@/content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));
vi.mock("@/downloads/config", () => ({ useWriteRootPath: () => "/content" }));
vi.mock("@/hub/assets/useMapPicture", () => ({
  useMapPictureRung: () => ({
    picture: { from: "placeholder" },
    onError: vi.fn(),
  }),
}));

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  useSetting: () => [autoDownload.enabled, vi.fn()],
}));

beforeEach(() => {
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = { transformCallback: (cb: unknown) => cb };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  autoDownload.enabled = false;
});

const stillMissing = async () => ({ game: false, map: false });

describe("the missing-map box", () => {
  it("says so when the download worked and the map is still missing", async () => {
    downloadMapAnySource.mockResolvedValueOnce("mirror");
    render(
      <DownloadQueueProvider>
        <MissingMapBox
          battleId={1}
          mapName="Altair_Crossing_V4.1"
          onRescan={stillMissing}
          picture={[]}
        />
      </DownloadQueueProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "Download" }).click();
    });

    await waitFor(() =>
      expect(screen.getByText(/Downloaded to \/content/)).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download again" })).toBeTruthy();
  });

  it("shows a bar before the first progress event", async () => {
    downloadMapAnySource.mockReturnValueOnce(new Promise(() => {}));
    render(
      <DownloadQueueProvider>
        <MissingMapBox
          battleId={2}
          mapName="Altair_Crossing_V4.1"
          onRescan={stillMissing}
          picture={[]}
        />
      </DownloadQueueProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "Download" }).click();
    });

    await waitFor(() => expect(screen.getByText("Starting…")).toBeTruthy());
  });

  it("rescans before downloading on join, and skips a map already on disk", async () => {
    autoDownload.enabled = true;
    const onRescan = vi.fn(async () => ({ game: false, map: true }));
    render(
      <DownloadQueueProvider>
        <MissingMapBox
          battleId={3}
          mapName="Altair_Crossing_V4.1"
          onRescan={onRescan}
          picture={[]}
        />
      </DownloadQueueProvider>,
    );

    await waitFor(() => expect(onRescan).toHaveBeenCalledTimes(1));
    expect(downloadMapAnySource).not.toHaveBeenCalled();
  });
});
