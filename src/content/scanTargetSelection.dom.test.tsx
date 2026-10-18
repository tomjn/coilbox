// @vitest-environment happy-dom

/**
 * Which engine's content the pages show (issue #4643). The preferred engine from
 * Settings decides it everywhere except Engine config and Engine profiles, so an
 * old `content.scanTarget` pick must not override it.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  setScanTarget: vi.fn(),
}));

vi.mock("@picoframe/frame", () => ({
  useSetting: (key: string, fallback: unknown) => [
    h.settings[key] ?? fallback,
    key === "content.scanTarget" ? h.setScanTarget : vi.fn(),
  ],
}));
vi.mock("./contentState", () => ({
  useContentState: () => ({
    state: {
      roots: [
        {
          path: "/data",
          engines: [
            { id: "old", path: "/e/old", version: "100.0" },
            { id: "new", path: "/e/new", version: "105.0" },
            { id: "mid", path: "/e/mid", version: "104.0" },
          ],
        },
      ],
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import { useEngineEditTarget, useScanTargetSelection } from "./config";

beforeEach(() => {
  h.settings = {};
});

describe("useScanTargetSelection", () => {
  it("follows the preferred engine", () => {
    h.settings["content.preferredEngineId"] = "mid";
    const { result } = renderHook(() => useScanTargetSelection());
    expect(result.current.selected?.engineId).toBe("mid");
  });

  it("falls back to the newest engine with no preference", () => {
    const { result } = renderHook(() => useScanTargetSelection());
    expect(result.current.selected?.engineId).toBe("new");
  });

  it("ignores an old saved scan target that differs from the preferred engine", () => {
    h.settings["content.preferredEngineId"] = "mid";
    h.settings["content.scanTarget"] = "/data::old";
    const { result } = renderHook(() => useScanTargetSelection());
    expect(result.current.selected?.engineId).toBe("mid");
  });
});

describe("useEngineEditTarget", () => {
  it("lets the saved pick choose any installed engine", () => {
    h.settings["content.preferredEngineId"] = "mid";
    h.settings["content.scanTarget"] = "/data::old";
    const { result } = renderHook(() => useEngineEditTarget());
    expect(result.current.selected?.engineId).toBe("old");
    expect(result.current.targets).toHaveLength(3);
  });

  it("starts on the preferred engine with no saved pick", () => {
    h.settings["content.preferredEngineId"] = "mid";
    const { result } = renderHook(() => useEngineEditTarget());
    expect(result.current.selected?.engineId).toBe("mid");
  });
});
