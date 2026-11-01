import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/content/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/content/bindings")>()),
  unitsyncEngineConfig: vi.fn(async () => ({ configPath: "" })),
  unitsyncLastScanRead: vi.fn(async () => null),
  unitsyncLastScanWrite: vi.fn(async () => null),
  unitsyncScan: vi.fn(),
}));

import { unitsyncEngineConfig, unitsyncScan } from "@/content/bindings";
import { primeScan, settledScan } from "@/content/config";
import { writeSetForLaunch } from "./widgetSync";

const scan = { maps: [], games: [], errors: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

it("has nothing settled before any scan", () => {
  expect(settledScan("/e1", "/d1")).toBeNull();
});

it("hands over a finished scan", async () => {
  vi.mocked(unitsyncScan).mockResolvedValueOnce(scan);
  await primeScan("/e2", "/d2");
  expect(settledScan("/e2", "/d2")?.maps).toEqual([]);
});

it("has nothing settled during a rescan, because the answer is changing", async () => {
  vi.mocked(unitsyncScan).mockResolvedValueOnce(scan);
  await primeScan("/e3", "/d3");
  let finish: (value: typeof scan) => void = () => {};
  vi.mocked(unitsyncScan).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );

  const rescan = primeScan("/e3", "/d3", true);
  expect(settledScan("/e3", "/d3")).toBeNull();

  finish(scan);
  await rescan;
  expect(settledScan("/e3", "/d3")).not.toBeNull();
});

it("does not wait on unitsync when a launch finds no settled scan", async () => {
  await expect(
    writeSetForLaunch({ enginePath: "/e4", dataDir: "/d4", game: "g" }),
  ).rejects.toThrow(/still scanning/);
  expect(unitsyncScan).not.toHaveBeenCalled();
  expect(unitsyncEngineConfig).not.toHaveBeenCalled();
});
