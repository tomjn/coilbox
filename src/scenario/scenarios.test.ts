// @vitest-environment happy-dom

/**
 * The wiring `useScenarios` does between coilbox's own storage and a game's
 * own archive, run rather than read.
 *
 * The two halves have different triggers: the stored documents depend on
 * nothing, a game's missions depend on the installed games list, which the
 * content scan resolves a render after the first one (`usePreferredTarget`
 * and `useUnitsyncScan` both start out unresolved on every mount, even when
 * the scan itself is already cached). A review of Task 4 found the storage
 * half being re-read every time the games half changed, which is the
 * behaviour this pins: one storage read per mount, however many times the
 * games list resolves or changes under it.
 */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameItem } from "../content/bindings";

const listScenariosMock = vi.fn();
const gameScenariosMock = vi.fn();

/** What `useUnitsyncScan` currently reports, mutated between renders to
 *  stand in for the scan resolving after the first render the way it does
 *  for real. */
let scanData: { games: GameItem[] } | null = null;

/** What `usePreferredTarget` currently reports. Null stands in for a machine
 *  with no engine installed, where the scan never runs at all. */
let targetData: { enginePath: string; dataDir: string } | null = null;

vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    listScenarios: (...args: unknown[]) => listScenariosMock(...args),
  };
});
vi.mock("./gameScenarios", () => ({
  gameScenarios: (...args: unknown[]) => gameScenariosMock(...args),
}));
vi.mock("../content/config", () => ({
  useUnitsyncScan: () => ({ data: scanData, loading: false, error: null }),
}));
vi.mock("../play/config", () => ({
  usePreferredTarget: () => ({
    target: targetData,
    loading: false,
    error: null,
  }),
}));

const game = (name: string) =>
  ({ name, primaryArchive: { name, path: `/games/${name}` } }) as GameItem;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  scanData = null;
  targetData = { enginePath: "/engine", dataDir: "/data" };
  listScenariosMock.mockResolvedValue([]);
  gameScenariosMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("useScenarios", () => {
  it("reads stored scenarios once, and does not re-read them once the games list arrives", async () => {
    const { useScenarios } = await import("./scenarios");
    const { rerender } = renderHook(() => useScenarios());

    await waitFor(() => expect(listScenariosMock).toHaveBeenCalledTimes(1));
    // Nothing about a game's missions is read until the scan actually
    // answers, not even with an empty games list.
    expect(gameScenariosMock).not.toHaveBeenCalled();

    scanData = { games: [game("SplinterFaction")] };
    rerender();

    await waitFor(() =>
      expect(gameScenariosMock).toHaveBeenCalledWith([game("SplinterFaction")]),
    );
    expect(listScenariosMock).toHaveBeenCalledTimes(1);
  });

  it("stays loading until a game's own missions have been read", async () => {
    const { useScenarios } = await import("./scenarios");
    const { result, rerender } = renderHook(() => useScenarios());

    // The stored half has answered, and it found nothing. The games half has
    // not, because the scan has not resolved, so this must not read as a
    // finished empty list.
    await waitFor(() => expect(listScenariosMock).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);

    scanData = { games: [game("SplinterFaction")] };
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("settles with no engine installed, where the scan never answers", async () => {
    targetData = null;
    const { useScenarios } = await import("./scenarios");
    const { result } = renderHook(() => useScenarios());

    // Nothing can ship a mission without an engine, so waiting on the games
    // half here would hold the page loading for good.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(gameScenariosMock).not.toHaveBeenCalled();
  });
});
