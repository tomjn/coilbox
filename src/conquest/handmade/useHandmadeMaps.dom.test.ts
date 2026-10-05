// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The order the hand-made map list answers in (issue #3616). The saved maps
 * are known at once, and the game archives take one unitsync run a game, so
 * the saved ones must not wait for the archives. The unitsync layer is faked,
 * and each archive tree answers only when the test lets it.
 */

const h = vi.hoisted(() => ({
  list: vi.fn(),
  tree: vi.fn(),
  file: vi.fn(),
  scan: vi.fn(),
  epoch: 0,
}));

vi.mock("../bindings", () => ({ conquestMapList: h.list }));
vi.mock("../../content/bindings", () => ({
  unitsyncArchiveTree: h.tree,
  unitsyncArchiveFile: h.file,
}));
vi.mock("../../content/config", () => ({
  currentScan: h.scan,
  useScanEpoch: () => h.epoch,
}));
vi.mock("../../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
    loading: false,
  }),
}));

// happy-dom's URL will not make a file URL, so the path is built from here.
const MANIFEST = readFileSync(
  resolve(import.meta.dirname, "../../../docs/examples/handmade-map/map.json"),
  "utf8",
);
const SAVED_ID = JSON.parse(MANIFEST).id as string;

const game = (archive: string) => ({
  name: archive,
  primaryArchive: { name: archive },
  info: { shortname: "TG", version: "1" },
});

/** Tree reads waiting for the test to answer them, oldest first. */
let pending: { archive: string; answer: () => void }[] = [];

/** Answer every tree read that is waiting, and any that the answers start. */
async function answerTrees() {
  for (;;) {
    await new Promise((r) => setTimeout(r, 0));
    const now = pending;
    if (now.length === 0) return;
    pending = [];
    for (const p of now) p.answer();
  }
}

let useHandmadeMaps: typeof import("./useHandmadeMaps").useHandmadeMaps;

beforeEach(async () => {
  vi.resetModules();
  h.epoch = 0;
  pending = [];
  h.list.mockReset().mockResolvedValue({
    items: [
      {
        folder: SAVED_ID,
        source: "imported",
        manifest: MANIFEST,
        files: ["map.json", "picture.png"],
      },
    ],
  });
  h.scan
    .mockReset()
    .mockResolvedValue({ games: [game("a.sdz"), game("b.sdz")] });
  h.tree.mockReset().mockImplementation(
    ({ archive }: { archive: string }) =>
      new Promise((resolve) => {
        pending.push({ archive, answer: () => resolve({ files: [] }) });
      }),
  );
  ({ useHandmadeMaps } = await import("./useHandmadeMaps"));
});

afterEach(cleanup);

describe("the hand-made map list", () => {
  it("lists the saved maps before any game archive answers", async () => {
    const { result } = renderHook(() => useHandmadeMaps());
    await waitFor(() => expect(result.current.savedLoading).toBe(false));
    expect(result.current.maps.map((m) => m.id)).toEqual([SAVED_ID]);
    // The archives are still being read, so the whole list is not known yet.
    expect(result.current.loading).toBe(true);
    expect(h.tree).toHaveBeenCalledTimes(1);

    await answerTrees();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(h.tree).toHaveBeenCalledTimes(2);
    expect(result.current.maps.map((m) => m.id)).toEqual([SAVED_ID]);
  });

  it("answers a second visit from the session without reading the games again", async () => {
    const first = renderHook(() => useHandmadeMaps());
    await answerTrees();
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const reads = h.tree.mock.calls.length;

    const { result } = renderHook(() => useHandmadeMaps());
    expect(result.current.loading).toBe(false);
    expect(result.current.savedLoading).toBe(false);
    expect(result.current.maps.map((m) => m.id)).toEqual([SAVED_ID]);
    await answerTrees();
    expect(h.tree).toHaveBeenCalledTimes(reads);
  });

  it("reads the games again after a rescan and keeps the list up meanwhile", async () => {
    const { result, rerender } = renderHook(() => useHandmadeMaps());
    await answerTrees();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const reads = h.tree.mock.calls.length;

    h.epoch = 1;
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.savedLoading).toBe(false);
    expect(result.current.maps.map((m) => m.id)).toEqual([SAVED_ID]);

    await answerTrees();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(h.tree.mock.calls.length).toBe(reads + 2);
  });
});
