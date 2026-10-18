// @vitest-environment happy-dom
/**
 * The update check reads the library's disk listing. A listing that has not
 * landed looks like no games at all, so it must not report an update.
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const library = vi.hoisted(() => ({
  filesRead: false,
  games: new Set<string>(),
}));
const notify = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("../content/config", () => ({
  primeScan: vi.fn(),
  useScanTargetSelection: () => ({ selected: null }),
}));
vi.mock("../content/useLibrary", () => ({
  useLibrary: () => ({
    installedFiles: { games: library.games, maps: new Set() },
    filesRead: library.filesRead,
    refresh: async () => {},
  }),
}));
vi.mock("../downloads/config", () => ({ useWriteRootPath: () => "/w" }));
vi.mock("../downloads/DownloadQueueProvider", () => ({
  useDownloadQueue: () => ({ enqueue: vi.fn(), waitFor: vi.fn(), items: [] }),
}));
vi.mock("../notify/notify", () => ({ notify }));
vi.mock("../profile/profile", () => ({
  getProfile: () => ({ release: { repo: "owner/game" } }),
  getProfileRoot: () => "",
}));
vi.mock("./bindings", () => ({
  dlGithubLatestRelease: async () => ({
    tag: "v2",
    name: "v2",
    body: "",
    assets: [{ name: "Game-2.sdz", url: "https://example.test/g" }],
  }),
}));

const { GameUpdatesProvider, useGameUpdates } = await import(
  "./GameUpdatesProvider"
);

const wrapper = ({ children }: { children: ReactNode }) => (
  <GameUpdatesProvider>{children}</GameUpdatesProvider>
);

afterEach(() => {
  cleanup();
  notify.mockClear();
});

describe("the game update check", () => {
  it("reports nothing before the disk listing lands", async () => {
    library.filesRead = false;
    library.games = new Set();
    const { result } = renderHook(() => useGameUpdates(), { wrapper });
    await waitFor(() => expect(result.current.release).not.toBeNull());
    expect(result.current.updateAvailable).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports an update the listing does not have", async () => {
    library.filesRead = true;
    library.games = new Set(["game-1.sdz"]);
    const { result } = renderHook(() => useGameUpdates(), { wrapper });
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));
  });

  it("reports nothing once the listing has the release", async () => {
    library.filesRead = true;
    library.games = new Set(["game-2.sdz"]);
    const { result } = renderHook(() => useGameUpdates(), { wrapper });
    await waitFor(() => expect(result.current.release).not.toBeNull());
    expect(result.current.updateAvailable).toBe(false);
  });
});
