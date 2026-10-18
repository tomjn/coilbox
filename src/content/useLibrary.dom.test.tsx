// @vitest-environment happy-dom
/**
 * The hook behind the library record: it reads the disk listing, merges the
 * mirror indexes a page asks for, and reads the disk again when a download
 * finishes.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dlInstalledContent = vi.hoisted(() => vi.fn());
const dlHakoraMaps = vi.hoisted(() => vi.fn());
const completeListeners = vi.hoisted(() => new Set<() => void>());

vi.mock("../downloads/bindings", () => ({
  dlInstalledContent: (args: unknown) => dlInstalledContent(args),
  dlHakoraMaps: () => dlHakoraMaps(),
}));
vi.mock("../downloads/config", () => ({
  useContentRootPaths: () => ROOTS,
}));
vi.mock("../downloads/DownloadQueueProvider", () => ({
  useDownloadQueue: () => ({ items: [] }),
  useDownloadComplete: (cb: () => void) => {
    completeListeners.add(cb);
  },
}));
vi.mock("../hub/gameIcons", () => ({ useHubGames: () => null }));

const ROOTS = ["/content"];

const { useLibrary } = await import("./useLibrary");
const { invalidateInstalledContent } = await import("./installedContent");
const { invalidateMirrorIndexes } = await import("../downloads/mirrorIndex");

beforeEach(() => {
  invalidateInstalledContent();
  invalidateMirrorIndexes();
  completeListeners.clear();
  dlInstalledContent.mockReset();
  dlHakoraMaps.mockReset();
});

describe("useLibrary", () => {
  it("marks archives on disk as installed and merges the mirror asked for", async () => {
    dlInstalledContent.mockResolvedValue({
      maps: ["throne_v8.sd7"],
      games: [],
    });
    dlHakoraMaps.mockResolvedValue({
      maps: [
        { filename: "Throne_v8.sd7", url: "https://h.example/t", size: "1M" },
        { filename: "Talus.sd7", url: "https://h.example/u", size: "2M" },
      ],
    });
    const catalogues = [{ source: "hakora" as const }];
    const { result } = renderHook(() => useLibrary({ catalogues }));

    await waitFor(() => expect(result.current.maps).toHaveLength(2));
    expect(result.current.installedFiles.maps.has("throne_v8.sd7")).toBe(true);
    expect(result.current.maps.map((m) => [m.id, m.state])).toEqual([
      ["Talus", "available"],
      ["Throne_v8", "installed"],
    ]);
    expect(dlInstalledContent).toHaveBeenCalledWith({ paths: ROOTS });
  });

  it("reads the disk again when a download finishes", async () => {
    dlInstalledContent.mockResolvedValue({ maps: [], games: [] });
    const { result } = renderHook(() => useLibrary());
    await waitFor(() => expect(dlInstalledContent).toHaveBeenCalledTimes(1));

    // The queue clears the listing cache when it finishes a download.
    invalidateInstalledContent();
    dlInstalledContent.mockResolvedValue({ maps: ["new.sd7"], games: [] });
    act(() => {
      for (const cb of completeListeners) cb();
    });

    await waitFor(() =>
      expect(result.current.installedFiles.maps.has("new.sd7")).toBe(true),
    );
    expect(result.current.maps.map((m) => [m.id, m.state])).toEqual([
      ["new", "local"],
    ]);
  });

  // A failed read is not a report that the player has nothing. Dropping the
  // listing would re-offer every map they have.
  it("keeps the last listing when a read fails", async () => {
    dlInstalledContent.mockResolvedValue({ maps: ["throne_v8.sd7"], games: [] });
    const { result } = renderHook(() => useLibrary());
    await waitFor(() =>
      expect(result.current.installedFiles.maps.has("throne_v8.sd7")).toBe(true),
    );

    invalidateInstalledContent();
    dlInstalledContent.mockRejectedValue(new Error("disk"));
    act(() => {
      for (const cb of completeListeners) cb();
    });

    await waitFor(() => expect(dlInstalledContent).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(result.current.installedFiles.maps.has("throne_v8.sd7")).toBe(true);
    expect(result.current.filesRead).toBe(true);
  });

  // A caller that acts on "the player has no maps" has to tell a listing that
  // has not landed from an empty one, and has to stop waiting once the read
  // has gone as far as it will.
  it("says when the disk has answered, even with a failure", async () => {
    let fail: (e: Error) => void = () => {};
    dlInstalledContent.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const { result } = renderHook(() => useLibrary());
    await waitFor(() => expect(dlInstalledContent).toHaveBeenCalledTimes(1));
    expect(result.current.filesAnswered).toBe(false);
    expect(result.current.filesRead).toBe(false);

    await act(async () => fail(new Error("disk")));
    expect(result.current.filesAnswered).toBe(true);
    expect(result.current.filesRead).toBe(false);
  });

  it("says a listing has been read once one lands", async () => {
    dlInstalledContent.mockResolvedValue({ maps: [], games: [] });
    const { result } = renderHook(() => useLibrary());
    expect(result.current.filesRead).toBe(false);
    await waitFor(() => expect(result.current.filesRead).toBe(true));
    expect(result.current.filesAnswered).toBe(true);
  });
});
