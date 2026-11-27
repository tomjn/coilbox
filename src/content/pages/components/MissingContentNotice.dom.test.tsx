// @vitest-environment happy-dom

/**
 * The replay page's missing-content banner: collapsed to one row until opened,
 * and downloading the game the way a battle room does (every source, not only
 * rapid).
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "@/downloads/DownloadQueueProvider";
import type { ReplayEngine } from "../../useReplayEngine";
import { MissingContentNotice } from "./MissingContentNotice";

const downloadGameAnySource = vi.hoisted(() => vi.fn());
const dlDownload = vi.hoisted(() => vi.fn());

vi.mock("@/downloads/bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload,
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
vi.mock("@/content/config", () => ({
  forgetScans: vi.fn(),
  invalidateScans: vi.fn(),
  rescanMounted: vi.fn(),
}));
vi.mock("@/content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));
vi.mock("@/downloads/config", () => ({
  useWriteRootPath: () => "/content",
  useWriteRoot: () => ({ path: "/content", loading: false }),
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

const engine = { notice: { kind: "none" } } as unknown as ReplayEngine;

function show(gameType = "Splinter Faction v1.2") {
  return render(
    <MemoryRouter>
      <DownloadQueueProvider>
        <MissingContentNotice
          gameType={gameType}
          mapName="Some Map"
          missingGame
          missingMap={false}
          engine={engine}
          onMapDownloaded={() => {}}
        />
      </DownloadQueueProvider>
    </MemoryRouter>,
  );
}

describe("the missing-content banner", () => {
  it("starts collapsed to a row with the title, and opens to show the download", () => {
    show();
    const row = screen.getByRole("button", { name: /Game not installed/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Download game" })).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Download game" })).toBeTruthy();

    fireEvent.click(row);
    expect(screen.queryByRole("button", { name: "Download game" })).toBeNull();
  });

  it("downloads the game from any source by name, not from rapid alone", async () => {
    downloadGameAnySource.mockResolvedValueOnce(undefined);
    show();
    fireEvent.click(screen.getByRole("button", { name: /Game not installed/ }));
    act(() => {
      screen.getByRole("button", { name: "Download game" }).click();
    });

    await waitFor(() => expect(downloadGameAnySource).toHaveBeenCalledTimes(1));
    expect(downloadGameAnySource.mock.calls[0][0]).toMatchObject({
      gameName: "Splinter Faction v1.2",
      writePath: "/content",
    });
    expect(dlDownload).not.toHaveBeenCalled();
  });

  it("says why the download failed", async () => {
    downloadGameAnySource.mockRejectedValueOnce(new Error("no mirror had it"));
    show();
    fireEvent.click(screen.getByRole("button", { name: /Game not installed/ }));
    act(() => {
      screen.getByRole("button", { name: "Download game" }).click();
    });
    await waitFor(() =>
      expect(screen.getByText("no mirror had it")).toBeTruthy(),
    );
  });

  it("offers no download for a compat mutator, which no source has", () => {
    show("XTA 9.65 (compat 4)");
    fireEvent.click(screen.getByRole("button", { name: /Game not installed/ }));
    const button = screen.getByRole("button", {
      name: "Download game",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(downloadGameAnySource).not.toHaveBeenCalled();
  });
});
