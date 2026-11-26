// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentRoot, ContentState } from "../bindings";

const root = (id: string, extra: Partial<ContentRoot> = {}) =>
  ({
    id,
    path: `/data/${id}`,
    source: "auto",
    kind: "data",
    origins: [],
    exists: true,
    valid: true,
    portable: false,
    counts: { engines: 0, maps: 0, games: 0, packages: 0 },
    engines: [],
    ...extra,
  }) as unknown as ContentRoot;

const h = vi.hoisted(() => ({
  state: null as ContentState | null,
  downloads: { rapidRepos: [] } as Record<string, unknown>,
  setDownloads: vi.fn(),
  removeRoot: vi.fn(),
}));

vi.mock("../bindings", () => ({
  contentAddRoot: vi.fn(),
  contentCreateStandardRoot: vi.fn(),
  contentOpenPath: vi.fn(),
  contentRemoveRoot: h.removeRoot,
  contentRescan: vi.fn(),
  contentScanRoot: vi.fn(),
  contentSetReadOnly: vi.fn(),
}));
vi.mock("../config", () => ({
  useContentState: () => ({
    state: h.state,
    setState: (s: ContentState) => {
      h.state = s;
    },
    loading: false,
    error: null,
  }),
  useContentPrefs: () => [
    {
      autoScanOnStartup: false,
      probeZeroK: false,
      fetchListsInBackground: true,
    },
    vi.fn(),
  ],
  useSetupStatus: () => ({ standardPath: null }),
}));
vi.mock("../../downloads/config", () => ({
  useDefaultWriteRoot: () => vi.fn(),
  useDownloadsConfig: () => [h.downloads, h.setDownloads],
  useWriteRootPath: () => undefined,
}));
vi.mock("./components/DownloadFolders", () => ({
  DownloadFolders: () => null,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const { default: FoldersSection } = await import("./FoldersSection");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FoldersSection", () => {
  it("moves the default download folder off a folder the user removes", async () => {
    const added = root("added", { source: "manual" });
    const other = root("other");
    h.state = { roots: [added, other] } as unknown as ContentState;
    h.downloads = { rapidRepos: [], writeRootId: "added" };
    h.removeRoot.mockResolvedValue({ state: { roots: [other] } });

    render(<FoldersSection />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await vi.waitFor(() => expect(h.setDownloads).toHaveBeenCalled());

    expect(h.removeRoot).toHaveBeenCalledWith({ path: "/data/added" });
    expect(h.setDownloads).toHaveBeenCalledWith({
      rapidRepos: [],
      writeRootId: "other",
    });
  });

  it("leaves the default alone when another folder is removed", async () => {
    const added = root("added", { source: "manual" });
    const other = root("other");
    h.state = { roots: [added, other] } as unknown as ContentState;
    h.downloads = { rapidRepos: [], writeRootId: "other" };
    h.removeRoot.mockResolvedValue({ state: { roots: [other] } });

    render(<FoldersSection />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await vi.waitFor(() => expect(h.removeRoot).toHaveBeenCalled());
    await Promise.resolve();

    expect(h.setDownloads).not.toHaveBeenCalled();
  });
});
