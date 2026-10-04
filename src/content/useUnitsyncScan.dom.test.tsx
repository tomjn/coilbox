// @vitest-environment happy-dom

/**
 * What the scan hook hands back when unitsync's `Init` failed (issue #3423). The
 * worker prints a result with empty lists and the engine's reason in
 * `initFailure`. That result does not say what is installed, so the hook treats
 * it as a scan that threw, and keeps the raw result apart for the two list pages
 * that show it beside the failure.
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanResult } from "./bindings";

const { unitsyncScan } = vi.hoisted(() => ({ unitsyncScan: vi.fn() }));

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  unitsyncScan,
}));

const { primeScan, useUnitsyncScan } = await import("./config");

const failed: ScanResult = {
  maps: [],
  games: [],
  errors: [],
  initFailure: "no space left on device",
};
const answered: ScanResult = {
  maps: [],
  games: [],
  errors: [],
};

afterEach(cleanup);

let n = 0;
let dir = "";

beforeEach(() => {
  unitsyncScan.mockReset();
  n += 1;
  dir = `/data-${n}`;
});

describe("useUnitsyncScan on a failed Init", () => {
  it("hands back no data, the reason as the error, and the raw result apart", async () => {
    unitsyncScan.mockResolvedValue(failed);
    const { result } = renderHook(() => useUnitsyncScan("/engine", dir));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("no space left on device");
    expect(result.current.unvouched).toEqual(failed);
  });

  it("resolves run() with null", async () => {
    unitsyncScan.mockResolvedValue(failed);
    const { result } = renderHook(() => useUnitsyncScan("/engine", dir));
    let found: ScanResult | null | undefined;
    await act(async () => {
      found = await result.current.run(true);
    });
    expect(found).toBeNull();
  });

  it("does not cache the failure, so reopening rescans", async () => {
    unitsyncScan.mockResolvedValueOnce(failed).mockResolvedValueOnce(answered);
    const first = renderHook(() => useUnitsyncScan("/engine", dir));
    await waitFor(() => expect(first.result.current.error).not.toBeNull());
    first.unmount();

    const second = renderHook(() => useUnitsyncScan("/engine", dir));
    await waitFor(() => expect(second.result.current.data).toEqual(answered));
    expect(second.result.current.error).toBeNull();
    expect(second.result.current.unvouched).toBeNull();
    expect(unitsyncScan).toHaveBeenCalledTimes(2);
  });

  it("makes primeScan throw the reason", async () => {
    unitsyncScan.mockResolvedValue(failed);
    await expect(primeScan("/engine", dir)).rejects.toThrow(
      "no space left on device",
    );
  });
});

describe("useUnitsyncScan on a scan that answered", () => {
  it("hands back the result as data, with no raw result apart", async () => {
    unitsyncScan.mockResolvedValue(answered);
    const { result } = renderHook(() => useUnitsyncScan("/engine", dir));
    await waitFor(() => expect(result.current.data).toEqual(answered));
    expect(result.current.error).toBeNull();
    expect(result.current.unvouched).toBeNull();
  });

  it("resolves run() with the result", async () => {
    unitsyncScan.mockResolvedValue(answered);
    const { result } = renderHook(() => useUnitsyncScan("/engine", dir));
    let found: ScanResult | null | undefined;
    await act(async () => {
      found = await result.current.run(true);
    });
    expect(found).toEqual(answered);
  });
});

describe("useUnitsyncScan on a rescan that fails after an answer (issue #3431)", () => {
  const earlier: ScanResult = {
    maps: [],
    games: [],
    errors: ["earlier"],
  };

  async function answeredHook() {
    const hook = renderHook(() => useUnitsyncScan("/engine", dir));
    await waitFor(() => expect(hook.result.current.data).toEqual(earlier));
    return hook;
  }

  it("drops the earlier data when the rescan's Init fails", async () => {
    unitsyncScan.mockResolvedValueOnce(earlier).mockResolvedValueOnce(failed);
    const { result } = await answeredHook();
    await act(async () => {
      await result.current.run(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("no space left on device");
    expect(result.current.unvouched).toEqual(failed);
  });

  it("drops the earlier data when the rescan throws", async () => {
    unitsyncScan
      .mockResolvedValueOnce(earlier)
      .mockRejectedValueOnce(new Error("worker crashed"));
    const { result } = await answeredHook();
    await act(async () => {
      await result.current.run(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("worker crashed");
  });

  it("keeps the earlier data when the rescan is cancelled", async () => {
    unitsyncScan
      .mockResolvedValueOnce(earlier)
      .mockRejectedValueOnce(new Error("scan cancelled"));
    const { result } = await answeredHook();
    await act(async () => {
      await result.current.run(true);
    });
    expect(result.current.data).toEqual(earlier);
    expect(result.current.cancelled).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("does not serve the earlier answer to a page opened after a failed Init rescan", async () => {
    unitsyncScan
      .mockResolvedValueOnce(earlier)
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(answered);
    const first = await answeredHook();
    await act(async () => {
      await first.result.current.run(true);
    });
    first.unmount();

    const second = renderHook(() => useUnitsyncScan("/engine", dir));
    await waitFor(() => expect(second.result.current.data).toEqual(answered));
    expect(unitsyncScan).toHaveBeenCalledTimes(3);
  });

  it("does not serve the earlier answer to a page opened after a thrown rescan", async () => {
    unitsyncScan
      .mockResolvedValueOnce(earlier)
      .mockRejectedValueOnce(new Error("worker crashed"));
    const first = await answeredHook();
    await act(async () => {
      await first.result.current.run(true);
    });
    first.unmount();

    const second = renderHook(() => useUnitsyncScan("/engine", dir));
    await waitFor(() =>
      expect(second.result.current.error).toBe("worker crashed"),
    );
    expect(second.result.current.data).toBeNull();
    expect(unitsyncScan).toHaveBeenCalledTimes(2);
  });

  it("keeps the earlier answer in the cache after a cancelled rescan", async () => {
    unitsyncScan
      .mockResolvedValueOnce(earlier)
      .mockRejectedValueOnce(new Error("scan cancelled"));
    const first = await answeredHook();
    await act(async () => {
      await first.result.current.run(true);
    });
    first.unmount();

    const second = renderHook(() => useUnitsyncScan("/engine", dir));
    await waitFor(() => expect(second.result.current.data).toEqual(earlier));
    expect(unitsyncScan).toHaveBeenCalledTimes(2);
  });
});
