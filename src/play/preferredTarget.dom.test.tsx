// @vitest-environment happy-dom
/**
 * Which engine a screen launches. Singleplayer takes the preferred engine. A
 * multiplayer battle names a version, and an installed engine of exactly that
 * version has to win, because the host's engine refuses every other one.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const engine = (id: string, version: string, syncVersion?: string) => ({
  id,
  version,
  syncVersion,
  path: `/root/engine/${id}`,
  executable: `/root/engine/${id}/spring`,
});

const roots = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("../content/config", () => ({
  useContentState: () => ({
    state: { roots: roots.current },
    loading: false,
    error: null,
  }),
  // The newer engine is the preferred one.
  usePreferredEngine: () => ({ resolvedId: "new" }),
  useUnitsyncScan: () => ({ data: null, loading: false }),
  primeGameInfo: vi.fn(),
  primeMapInfo: vi.fn(),
}));

import { usePreferredTarget } from "./config";

roots.current = [
  {
    path: "/root",
    engines: [
      engine("new", "recoil_2026.03.01", "2026.03.01"),
      engine("old", "recoil_2025.06.20", "2025.06.20"),
      engine("folder", "2024.11.02"),
    ],
  },
];

describe("usePreferredTarget", () => {
  it("takes the preferred engine when no version is asked for", () => {
    const { result } = renderHook(() => usePreferredTarget());
    expect(result.current.target?.engineVersion).toBe("2026.03.01");
  });

  it("takes the installed engine of the version a battle asks for", () => {
    const { result } = renderHook(() => usePreferredTarget("2025.06.20"));
    expect(result.current.target?.executable).toBe("/root/engine/old/spring");
  });

  it("never matches an engine on its folder name", () => {
    const { result } = renderHook(() => usePreferredTarget("2024.11.02"));
    expect(result.current.target?.executable).toBe("/root/engine/new/spring");
  });

  it("falls back to the preferred engine when the version is not installed", () => {
    const { result } = renderHook(() => usePreferredTarget("2023.01.01"));
    expect(result.current.target?.engineVersion).toBe("2026.03.01");
  });

  it("lists every installed engine for a picker", () => {
    const { result } = renderHook(() => usePreferredTarget());
    expect(result.current.targets.map((t) => t.engineVersion)).toEqual([
      "2026.03.01",
      "2025.06.20",
      "2024.11.02",
    ]);
  });
});
