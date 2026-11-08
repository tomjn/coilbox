// @vitest-environment happy-dom
/**
 * Which engine a replay's Watch runs on. The recorded version is matched against
 * what an engine reported, never against its folder name (issue #3452), the same
 * rule `usePreferredTarget` applies to a battle.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    refresh: async () => {},
  }),
  usePreferredEngine: () => ({ resolvedId: "pref" }),
  useUnitsyncScan: () => ({ data: null, loading: false }),
  primeGameInfo: vi.fn(),
  primeMapInfo: vi.fn(),
}));
vi.mock("../downloads/DownloadQueueProvider", () => ({
  useDownloadComplete: () => {},
}));

import { useReplayTarget } from "./config";

afterEach(cleanup);

const RECORDED = "105.1.1-2511-gabc1234 BAR105";

describe("useReplayTarget", () => {
  it("matches an engine that reported the recorded version", () => {
    roots.current = [
      {
        path: "/root",
        engines: [
          engine("pref", "recoil_2026.03.01", "2026.03.01"),
          engine("rec", "any-folder", RECORDED),
        ],
      },
    ];
    const { result } = renderHook(() => useReplayTarget(RECORDED));
    expect(result.current.resolved?.matched).toBe(true);
    expect(result.current.resolved?.target.executable).toBe(
      "/root/engine/rec/spring",
    );
  });

  it("does not match an engine that has not reported, whatever its folder is called", () => {
    roots.current = [
      {
        path: "/root",
        engines: [
          engine("pref", "recoil_2026.03.01", "2026.03.01"),
          engine("folder", "105.1.1-2511-gabc1234"),
        ],
      },
    ];
    const { result } = renderHook(() => useReplayTarget(RECORDED));
    expect(result.current.resolved?.matched).toBe(false);
    expect(result.current.resolved?.target.executable).toBe(
      "/root/engine/pref/spring",
    );
  });

  // Issue #1340: two unparseable strings compare equal, so a recorded ".spring"
  // would otherwise pick an engine that reported ".spring".
  it.each([
    ["a hidden folder", ".spring"],
    ["whitespace", "   "],
  ])("does not match an engine whose reported version is %s", (_name, bad) => {
    roots.current = [
      {
        path: "/root",
        engines: [
          engine("pref", "recoil_2026.03.01", "2026.03.01"),
          engine("odd", "any-folder", bad),
        ],
      },
    ];
    const { result } = renderHook(() => useReplayTarget(bad));
    expect(result.current.resolved?.matched).toBe(false);
    expect(result.current.resolved?.target.executable).toBe(
      "/root/engine/pref/spring",
    );
  });

  it("does not match a verified engine on its folder name when it reports another version", () => {
    roots.current = [
      {
        path: "/root",
        engines: [
          engine("pref", "recoil_2026.03.01", "2026.03.01"),
          engine("lies", "105.1.1-2511-gabc1234", "104.0.1-1828-g1234567"),
        ],
      },
    ];
    const { result } = renderHook(() => useReplayTarget(RECORDED));
    expect(result.current.resolved?.matched).toBe(false);
  });
});
