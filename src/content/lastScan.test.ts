import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  unitsyncLastScanRead: vi.fn(),
  unitsyncLastScanWrite: vi.fn(async () => null),
  unitsyncScan: vi.fn(),
}));

import {
  unitsyncLastScanRead,
  unitsyncLastScanWrite,
  unitsyncScan,
} from "./bindings";
import { primeScan } from "./config";
import { readLastScan, writeLastScan } from "./lastScan";

const scan = { maps: [], games: [], errors: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the last scan store", () => {
  it("reads what the plugin holds for the target", async () => {
    vi.mocked(unitsyncLastScanRead).mockResolvedValueOnce(scan);
    expect(await readLastScan("/e1", "/d1")).toEqual(scan);
    expect(unitsyncLastScanRead).toHaveBeenCalledWith({
      enginePath: "/e1",
      dataDir: "/d1",
    });
  });

  it("asks the plugin once per target in a session", async () => {
    vi.mocked(unitsyncLastScanRead).mockResolvedValue(scan);
    await readLastScan("/e2", "/d2");
    await readLastScan("/e2", "/d2");
    expect(unitsyncLastScanRead).toHaveBeenCalledTimes(1);
  });

  it("reads none when the plugin has none", async () => {
    vi.mocked(unitsyncLastScanRead).mockResolvedValueOnce(null);
    expect(await readLastScan("/e3", "/d3")).toBeNull();
  });

  it("reads none when the plugin answers with something that is not a scan", async () => {
    vi.mocked(unitsyncLastScanRead).mockResolvedValueOnce({
      maps: "no",
    } as never);
    expect(await readLastScan("/e4", "/d4")).toBeNull();
  });

  it("reads none when the plugin call fails", async () => {
    vi.mocked(unitsyncLastScanRead).mockRejectedValueOnce(new Error("boom"));
    expect(await readLastScan("/e5", "/d5")).toBeNull();
  });

  it("hands a scan it just wrote back without asking the plugin", async () => {
    writeLastScan("/e6", "/d6", scan);
    expect(await readLastScan("/e6", "/d6")).toEqual(scan);
    expect(unitsyncLastScanRead).not.toHaveBeenCalled();
    expect(unitsyncLastScanWrite).toHaveBeenCalledWith({
      enginePath: "/e6",
      dataDir: "/d6",
      scan,
    });
  });

  it("does not throw when the write fails", () => {
    vi.mocked(unitsyncLastScanWrite).mockRejectedValueOnce(new Error("full"));
    expect(() => writeLastScan("/e7", "/d7", scan)).not.toThrow();
  });
});

describe("the live scan and the store", () => {
  it("saves a scan that succeeded", async () => {
    vi.mocked(unitsyncScan).mockResolvedValueOnce(scan);
    await primeScan("/e8", "/d8");
    expect(unitsyncLastScanWrite).toHaveBeenCalledWith({
      enginePath: "/e8",
      dataDir: "/d8",
      scan,
    });
  });

  it("does not save a scan that failed", async () => {
    vi.mocked(unitsyncScan).mockRejectedValueOnce(new Error("no engine"));
    await expect(primeScan("/e9", "/d9")).rejects.toThrow("no engine");
    expect(unitsyncLastScanWrite).not.toHaveBeenCalled();
  });

  it("does not save a scan whose Init failed", async () => {
    vi.mocked(unitsyncScan).mockResolvedValueOnce({
      ...scan,
      initFailure: "disk full",
    });
    await expect(primeScan("/e10", "/d10")).rejects.toThrow("disk full");
    expect(unitsyncLastScanWrite).not.toHaveBeenCalled();
  });
});
