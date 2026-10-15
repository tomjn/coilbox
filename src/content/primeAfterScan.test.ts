import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  unitsyncScan: vi.fn(),
  unitsyncThumbnails: vi.fn(async () => ({ thumbnails: [], errors: [] })),
  unitsyncMapMeta: vi.fn(async () => ({ maps: [], errors: [] })),
  unitsyncGameHeaders: vi.fn(async () => ({ headers: [], errors: [] })),
}));

import {
  unitsyncGameHeaders,
  unitsyncMapMeta,
  unitsyncScan,
  unitsyncThumbnails,
} from "./bindings";
import { primeGameHeaders, primeMapMeta, primeThumbnails } from "./config";

const scanned = { maps: [], games: [], errors: [] };

let release: (value: typeof scanned) => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("batch reads wait for the scan", () => {
  // Each read gets its own target, because a finished scan is remembered.
  const reads = [
    ["game headers", primeGameHeaders, unitsyncGameHeaders],
    ["map metadata", primeMapMeta, unitsyncMapMeta],
    ["thumbnails", primeThumbnails, unitsyncThumbnails],
  ] as const;

  for (const [index, [label, prime, command]] of reads.entries()) {
    it(`asks for ${label} only once the scan has landed`, async () => {
      const dataDir = `/data-${index}`;
      vi.mocked(unitsyncScan).mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve as typeof release;
        }) as ReturnType<typeof unitsyncScan>,
      );

      const read = prime("/engine", dataDir);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(command).not.toHaveBeenCalled();

      release(scanned);
      await read;
      expect(command).toHaveBeenCalledTimes(1);
    });

    it(`still asks for ${label} when the scan fails`, async () => {
      vi.mocked(unitsyncScan).mockRejectedValueOnce(new Error("no engine"));
      await prime("/engine", `/failed-${index}`);
      expect(command).toHaveBeenCalledTimes(1);
    });
  }
});
