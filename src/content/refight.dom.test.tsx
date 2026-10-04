// @vitest-environment happy-dom

/**
 * What the refight setup says is missing when the scan's unitsync `Init`
 * failed (issue #3398). The scan came back with empty lists and a reason, which
 * is not a report that the replay's game and map are absent.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DemoInfo } from "./bindings";

const state = vi.hoisted(() => ({
  data: null as unknown,
  error: null as string | null,
}));

vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/e", dataDir: "/d" },
  }),
  useSkirmishAis: () => ({ ais: [] }),
}));
vi.mock("./config", () => ({
  useUnitsyncScan: () => ({
    data: state.data,
    loading: false,
    error: state.error,
    cancelled: false,
  }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false }),
}));

const { useRefightSetup } = await import("./refight");

const info = { gameType: "Some Game 1.0", mapName: "Some Map" } as DemoInfo;

describe("the refight setup when the scan did not answer", () => {
  it("does not call the game or map missing, and carries the reason", () => {
    state.data = null;
    state.error = "no space left";
    const { result } = renderHook(() => useRefightSetup(info));
    expect(result.current.missingGame).toBe(false);
    expect(result.current.missingMap).toBe(false);
    expect(result.current.scanFailure).toBe("no space left");
  });

  it("still calls them missing when the scan answered with empty lists", () => {
    state.data = { games: [], maps: [] };
    state.error = null;
    const { result } = renderHook(() => useRefightSetup(info));
    expect(result.current.missingGame).toBe(true);
    expect(result.current.missingMap).toBe(true);
    expect(result.current.scanFailure).toBeNull();
  });
});
