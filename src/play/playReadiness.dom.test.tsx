// @vitest-environment happy-dom
/**
 * What the readiness hook says when unitsync's Init failed. The scan hook then
 * answers `data: null` with the reason in `error`. That is an answer, so the
 * hook must settle on "unreadable" and stop loading (issue #3423).
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scan = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  engines: true,
  contentLoading: false,
}));

vi.mock("../content/config", () => ({
  useContentState: () => ({
    state: scan.engines
      ? {
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
        }
      : null,
    loading: scan.contentLoading,
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
  beforeEach(() => {
    scan.engines = true;
    scan.contentLoading = false;
  });

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

describe("usePlayReadiness before the engines are known", () => {
  const idle = {
    data: null,
    error: null,
    loading: false,
    cancelled: false,
    unvouched: null,
    run,
    cancel,
  };

  it("is finding the engine while the engine lookup runs", () => {
    scan.current = idle;
    scan.engines = false;
    scan.contentLoading = true;
    const { result } = renderHook(() => usePlayReadiness());
    expect(result.current.state).toBe("finding-engine");
    expect(result.current.loading).toBe(true);
  });

  it("is no-engine only once the lookup has finished and found none", () => {
    scan.current = idle;
    scan.engines = false;
    scan.contentLoading = false;
    const { result } = renderHook(() => usePlayReadiness());
    expect(result.current.state).toBe("no-engine");
    expect(result.current.loading).toBe(false);
  });
});
