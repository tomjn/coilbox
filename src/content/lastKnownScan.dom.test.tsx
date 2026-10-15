// @vitest-environment happy-dom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanResult } from "./bindings";

interface Live {
  data: ScanResult | null;
  unvouched: ScanResult | null;
  error: string | null;
  cancelled: boolean;
  loading: boolean;
}

const { live, readLastScan } = vi.hoisted(() => ({
  live: { current: null as unknown },
  readLastScan: vi.fn(),
}));
vi.mock("./config", () => ({ useUnitsyncScan: () => live.current }));
vi.mock("./lastScan", () => ({ readLastScan }));

import { useScanWithLastKnown } from "./lastKnownScan";

const map = (name: string) => ({ name }) as unknown as ScanResult["maps"][0];
const scan = (...names: string[]): ScanResult => ({
  maps: names.map(map),
  games: [],
  errors: [],
});

const SAVED = scan("Deleted Map", "Kept Map");
const LIVE = scan("Kept Map");

function setLive(next: Partial<Live>) {
  live.current = {
    data: null,
    unvouched: null,
    error: null,
    cancelled: false,
    loading: true,
    ...next,
  };
}

const names = (r: ScanResult | null) => r?.maps.map((m) => m.name);

beforeEach(() => {
  vi.clearAllMocks();
  setLive({});
  readLastScan.mockResolvedValue(SAVED);
});

describe("useScanWithLastKnown", () => {
  it("returns the saved scan as unchecked while the live scan runs", async () => {
    const { result } = renderHook(() => useScanWithLastKnown("/e", "/d"));
    await waitFor(() => expect(result.current.result).toEqual(SAVED));
    expect(result.current.unchecked).toBe(true);
    expect(result.current.status).toBe("checking");
    expect(result.current.data).toBeNull();
    expect(readLastScan).toHaveBeenCalledWith("/e", "/d");
  });

  it("returns the live scan, checked, once it lands, without the entry that went", async () => {
    const { result, rerender } = renderHook(() =>
      useScanWithLastKnown("/e", "/d"),
    );
    await waitFor(() => expect(names(result.current.result)).toHaveLength(2));

    setLive({ data: LIVE, loading: false });
    rerender();
    expect(names(result.current.result)).toEqual(["Kept Map"]);
    expect(result.current.unchecked).toBe(false);
    expect(result.current.status).toBe("checked");
    expect(result.current.data).toBe(LIVE);
  });

  it("keeps the saved list, marked failed, when the live scan fails", async () => {
    const { result, rerender } = renderHook(() =>
      useScanWithLastKnown("/e", "/d"),
    );
    await waitFor(() => expect(result.current.unchecked).toBe(true));

    setLive({ error: "worker crashed", loading: false });
    rerender();
    expect(names(result.current.result)).toEqual(["Deleted Map", "Kept Map"]);
    expect(result.current.unchecked).toBe(true);
    expect(result.current.status).toBe("failed");
    expect(result.current.data).toBeNull();
  });

  it("marks a cancelled scan failed to check, keeping the saved list", async () => {
    const { result, rerender } = renderHook(() =>
      useScanWithLastKnown("/e", "/d"),
    );
    await waitFor(() => expect(result.current.unchecked).toBe(true));

    setLive({ cancelled: true, loading: false });
    rerender();
    expect(result.current.unchecked).toBe(true);
    expect(result.current.status).toBe("failed");
  });

  it("prefers the saved list to the partial result of a failed Init", async () => {
    const partial = scan();
    setLive({ unvouched: partial, error: "Init failed", loading: false });
    const { result } = renderHook(() => useScanWithLastKnown("/e", "/d"));
    await waitFor(() => expect(result.current.result).toEqual(SAVED));
    expect(result.current.unchecked).toBe(true);
    expect(result.current.unvouched).toBe(partial);
  });

  it("falls back to the last live scan when a later rescan fails", async () => {
    setLive({ data: LIVE, loading: false });
    const { result, rerender } = renderHook(() =>
      useScanWithLastKnown("/e", "/d"),
    );
    setLive({ data: null, error: "disk gone", loading: false });
    rerender();
    await waitFor(() =>
      expect(names(result.current.result)).toEqual(["Kept Map"]),
    );
    expect(result.current.unchecked).toBe(true);
  });

  it("does not show one target's saved scan for another", async () => {
    const { result, rerender } = renderHook(
      ({ engine }) => useScanWithLastKnown(engine, "/d"),
      { initialProps: { engine: "/e1" } },
    );
    await waitFor(() => expect(result.current.unchecked).toBe(true));

    readLastScan.mockResolvedValue(null);
    rerender({ engine: "/e2" });
    await waitFor(() =>
      expect(readLastScan).toHaveBeenLastCalledWith("/e2", "/d"),
    );
    expect(result.current.result).toBeNull();
    expect(result.current.unchecked).toBe(false);
  });

  it("ignores a saved scan with nothing in it", async () => {
    readLastScan.mockResolvedValue(scan());
    const { result } = renderHook(() => useScanWithLastKnown("/e", "/d"));
    await waitFor(() => expect(readLastScan).toHaveBeenCalled());
    expect(result.current.result).toBeNull();
    expect(result.current.unchecked).toBe(false);
  });

  it("reads nothing without a target", () => {
    const { result } = renderHook(() =>
      useScanWithLastKnown(undefined, undefined),
    );
    expect(readLastScan).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });
});
