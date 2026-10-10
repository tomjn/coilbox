// @vitest-environment happy-dom

/**
 * The replay page's chart finds "me" through `usePrimaryPlayer`. That only needs
 * the stored records, so mounting it must read the stats store and never run the
 * library ingest, which walks every root and rewrites `stats.json` on each
 * replay page open.
 */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  contentStatsIngest: vi.fn(),
  contentStatsQuery: vi.fn(),
  contentStatsWatchStart: vi.fn(),
  contentStatsWatchStop: vi.fn(),
}));

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  ...bindings,
}));
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
}));
vi.mock("./replayUserState", () => ({
  useReplayUserState: () => ({ state: null }),
  refightFilenames: () => new Set<string>(),
}));
// One content root, so a hook that ingests has something to ingest.
vi.mock("./contentState", () => ({
  useContentState: () => ({
    state: { roots: [{ path: "/library", engines: [] }] },
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));
const profile = vi.hoisted(() => ({ hidden: false }));
vi.mock("../profile/hidden", () => ({ isProfileHidden: () => profile.hidden }));

const { usePrimaryPlayer } = await import("./usePrimaryPlayer");

const record = (filename: string, names: string[]) => ({
  filename,
  players: names.map((name) => ({ name, spectator: false })),
});

beforeEach(() => {
  for (const fn of Object.values(bindings)) fn.mockReset();
  bindings.contentStatsIngest.mockResolvedValue({ records: [], summary: {} });
  bindings.contentStatsWatchStart.mockResolvedValue({ watching: true });
  bindings.contentStatsWatchStop.mockResolvedValue({});
  profile.hidden = false;
});

afterEach(cleanup);

describe("usePrimaryPlayer", () => {
  it("finds the most frequent player from the stored records without ingesting", async () => {
    bindings.contentStatsQuery.mockResolvedValue({
      records: [
        record("a.sdfz", ["Alice", "Bob"]),
        record("b.sdfz", ["Alice", "Carol"]),
      ],
    });
    const { result } = renderHook(() => usePrimaryPlayer());
    await waitFor(() => expect(result.current).toBe("Alice"));
    expect(bindings.contentStatsQuery).toHaveBeenCalled();
    expect(bindings.contentStatsIngest).not.toHaveBeenCalled();
    expect(bindings.contentStatsWatchStart).not.toHaveBeenCalled();
  });

  it("names no one when nothing has been ingested yet", async () => {
    bindings.contentStatsQuery.mockResolvedValue({ records: [] });
    const { result } = renderHook(() => usePrimaryPlayer());
    await waitFor(() => expect(bindings.contentStatsQuery).toHaveBeenCalled());
    expect(result.current).toBe("");
    expect(bindings.contentStatsIngest).not.toHaveBeenCalled();
  });

  it("reads nothing when a profile hides statistics", async () => {
    profile.hidden = true;
    const { result } = renderHook(() => usePrimaryPlayer());
    expect(result.current).toBe("");
    expect(bindings.contentStatsQuery).not.toHaveBeenCalled();
    expect(bindings.contentStatsIngest).not.toHaveBeenCalled();
  });
});
