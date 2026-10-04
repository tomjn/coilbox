// @vitest-environment happy-dom
/**
 * What the readiness hook says when unitsync's Init failed. The scan hook then
 * answers `data: null` with the reason in `error`. That is an answer, so the
 * hook must settle on "unreadable" and stop loading (issue #3423).
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const scan = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("../content/config", () => ({
  useContentState: () => ({
    state: {
      roots: [
        {
          path: "/root",
          engines: [
            {
              id: "e",
              version: "2026.03.01",
              path: "/root/engine/e",
              executable: "/root/engine/e/spring",
            },
          ],
        },
      ],
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
  usePreferredEngine: () => ({ resolvedId: "e" }),
  useUnitsyncScan: () => scan.current,
  primeGameInfo: vi.fn(),
  primeMapInfo: vi.fn(),
}));

import { usePlayReadiness } from "./config";

const run = vi.fn();
const cancel = vi.fn();

describe("usePlayReadiness with a failed scan", () => {
  it("is unreadable, not scanning, and carries the reason", () => {
    scan.current = {
      data: null,
      error: "no space left on device",
      loading: false,
      cancelled: false,
      unvouched: null,
      run,
      cancel,
    };
    const { result } = renderHook(() => usePlayReadiness());
    expect(result.current.state).toBe("unreadable");
    expect(result.current.loading).toBe(false);
    expect(result.current.ready).toBe(true);
    expect(result.current.scanFailure).toBe("no space left on device");
  });

  it("is still scanning while a first scan runs", () => {
    scan.current = {
      data: null,
      error: null,
      loading: true,
      cancelled: false,
      unvouched: null,
      run,
      cancel,
    };
    const { result } = renderHook(() => usePlayReadiness());
    expect(result.current.state).toBe("scanning");
    expect(result.current.loading).toBe(true);
    expect(result.current.scanFailure).toBeNull();
  });
});
