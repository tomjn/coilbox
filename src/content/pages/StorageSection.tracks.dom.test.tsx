// @vitest-environment happy-dom
/**
 * Issue #3787. The track storage settings are part of the Storage page a
 * player opens, with or without content folders, and not only exported.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  roots: [] as { id: string; path: string; exists: boolean; engines: [] }[],
}));

vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("../config", () => ({
  useContentState: () => ({
    state: { roots: h.roots },
    setState: vi.fn(),
    loading: false,
  }),
  usePreferredEngine: () => ({ resolvedId: null }),
}));
vi.mock("../../downloads/DownloadQueueProvider", () => ({
  useDownloadQueue: () => ({ active: null, queued: [] }),
}));
vi.mock("../bindings", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../bindings");
  return {
    ...actual,
    contentStorageOverview: async () => ({
      overview: { categories: [], engines: [], totalBytes: 0 },
    }),
    contentUnitDefSetsUsage: async () => ({ sets: 0, replays: 0, bytes: 0 }),
    contentScanRoot: async () => ({}),
    contentReplayTracks: async () => ({
      tracks: [],
      totalBytes: 0,
      defaultBudgetBytes: 450 * 1024 * 1024,
    }),
  };
});
vi.mock("./components/BulkDeleteReplaysPanel", () => ({
  BulkDeleteReplaysPanel: () => null,
}));
vi.mock("./components/ReclaimSpaceButton", () => ({
  ReclaimSpaceButton: () => null,
}));
vi.mock("./components/ReclaimCachesButton", () => ({
  ReclaimCachesButton: () => null,
}));

const { default: StorageSection } = await import("./StorageSection");
const { resetReplayTracksForTests } = await import("../replayTracks");

afterEach(() => {
  cleanup();
  resetReplayTracksForTests();
  h.roots = [];
});

describe("the Storage page", () => {
  it("shows the track total beside the other storage, with a content folder", async () => {
    h.roots = [{ id: "r", path: "/games", exists: true, engines: [] }];
    render(<StorageSection />);

    expect(await screen.findByText(/0 B used of 450 MB/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /clear all tracks/i }),
    ).toBeTruthy();
  });

  it("shows it with no content folders too, since tracks are not in one", async () => {
    render(<StorageSection />);

    expect(screen.getByText(/no content folders to measure/i)).toBeTruthy();
    expect(await screen.findByText(/0 B used of 450 MB/)).toBeTruthy();
  });
});
