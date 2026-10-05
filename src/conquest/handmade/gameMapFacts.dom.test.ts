// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memorySettingsStorage } from "../../lib/storedSetting";

/**
 * What the "Generate a map" drawer and the Warpath form read about one game
 * (issue #3674): only the selected game's archive, kept in a cache the Conquest
 * list shares, and kept across a restart for a packaged archive. The unitsync
 * layer is faked and counts its calls. A restart is a fresh module graph over
 * the same settings storage.
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

const MANIFEST = readFileSync(
  resolve(import.meta.dirname, "../../../docs/examples/handmade-map/map.json"),
  "utf8",
);
const SHORTNAME = JSON.parse(MANIFEST).game.shortname as string;

/** How many installed games the fake machine has. */
const GAMES = 31;
/** The game that carries a map and asks for its own maps only. */
const CARRIER = 5;

const archiveOf = (n: number, ext = "sdz") =>
  `game${String(n).padStart(2, "0")}_1.${ext}`;

const gameItem = (n: number, ext = "sdz", extra: object = {}) => ({
  name: `Game ${n} v1`,
  primaryArchive: { name: archiveOf(n, ext), ...extra },
  dependencyArchives: [],
  // Only the carrier's maps are for the carrier's own game.
  info: { shortname: n === CARRIER ? SHORTNAME : `G${n}`, version: "1" },
});

let installed: ReturnType<typeof gameItem>[] = [];
let storage = memorySettingsStorage();

const treesRead = () =>
  h.tree.mock.calls.map((c) => (c[0] as { archive: string }).archive);

type Hooks = typeof import("./useHandmadeMaps");
let hooks: Hooks;

/** Start the app: a fresh module graph over the settings that survived. */
async function boot() {
  vi.resetModules();
  const stored = await import("../../lib/storedSetting");
  stored.installSettingsStorage(storage);
  hooks = await import("./useHandmadeMaps");
}

beforeEach(async () => {
  h.epoch = 0;
  storage = memorySettingsStorage();
  installed = Array.from({ length: GAMES }, (_, i) => gameItem(i + 1));
  h.list.mockReset().mockResolvedValue({ items: [] });
  h.scan.mockReset().mockImplementation(async () => ({ games: installed }));
  h.tree.mockReset().mockImplementation(async ({ archive }) => ({
    files:
      archive === archiveOf(CARRIER) || archive === archiveOf(CARRIER, "sdd")
        ? [
            { path: "coilbox/maps/index.json" },
            { path: "coilbox/maps/shores/map.json" },
            { path: "coilbox/maps/shores/picture.png" },
          ]
        : [{ path: "units/a.lua" }],
  }));
  h.file.mockReset().mockImplementation(async ({ file }) => ({
    kind: "text",
    text: file.endsWith("index.json")
      ? JSON.stringify({ onlyOwnMaps: true })
      : MANIFEST,
    errors: [],
    truncated: false,
  }));
  await boot();
});

afterEach(cleanup);

/** Render the form's read for one game and wait for its answer. */
async function open(n: number, ext = "sdz", extra: object = {}) {
  const view = renderHook(({ game }) => hooks.useGameMapFacts(game), {
    initialProps: { game: gameItem(n, ext, extra) as never },
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("the drawer's read of one game", () => {
  it("is loading until the answer is in, and reads only the selected game", async () => {
    const view = renderHook(({ game }) => hooks.useGameMapFacts(game), {
      initialProps: { game: gameItem(CARRIER) as never },
    });
    expect(view.result.current.loading).toBe(true);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(treesRead()).toEqual([archiveOf(CARRIER)]);
    expect(h.scan).not.toHaveBeenCalled();
    expect(view.result.current.facts.onlyOwnMaps).toEqual(["Game 5 v1"]);
    expect(view.result.current.facts.maps).toHaveLength(1);
  });

  it("reads nothing while no game is selected", async () => {
    const view = renderHook(() => hooks.useGameMapFacts(null));
    expect(view.result.current.loading).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.tree).not.toHaveBeenCalled();
  });

  it("reads only the new game when the game changes, and nothing for one read before", async () => {
    const view = await open(1);
    view.rerender({ game: gameItem(2) as never });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(treesRead()).toEqual([archiveOf(1), archiveOf(2)]);

    view.rerender({ game: gameItem(1) as never });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(treesRead()).toEqual([archiveOf(1), archiveOf(2)]);
  });

  it("reads nothing on a second open in the same session", async () => {
    (await open(CARRIER)).unmount();
    const reads = h.tree.mock.calls.length;
    const again = await open(CARRIER);
    expect(h.tree).toHaveBeenCalledTimes(reads);
    expect(again.result.current.facts.onlyOwnMaps).toEqual(["Game 5 v1"]);
  });
});

describe("the cache across a restart", () => {
  it("answers a packaged game from the stored cache without a worker run", async () => {
    (await open(CARRIER)).unmount();
    expect(h.tree).toHaveBeenCalledTimes(1);
    const fileReads = h.file.mock.calls.length;

    await boot();
    h.tree.mockClear();
    const view = await open(CARRIER);
    expect(h.tree).not.toHaveBeenCalled();
    expect(h.file).toHaveBeenCalledTimes(fileReads);
    // What was stored is the whole answer, not a placeholder.
    expect(view.result.current.facts.onlyOwnMaps).toEqual(["Game 5 v1"]);
    expect(view.result.current.facts.maps.map((m) => m.title)).toHaveLength(1);
  });

  it("reads an archive again when its name changes", async () => {
    (await open(1)).unmount();
    await boot();
    h.tree.mockClear();
    await open(1, "sdz", {});
    expect(h.tree).not.toHaveBeenCalled();

    // The game updated: a new version is a new archive name.
    const updated = gameItem(1);
    updated.primaryArchive.name = "game01_2.sdz";
    renderHook(() => hooks.useGameMapFacts(updated as never));
    await waitFor(() => expect(treesRead()).toEqual(["game01_2.sdz"]));
  });

  it("reads an archive again when its size or checksum changes under the same name", async () => {
    (await open(1, "sdz", { size: 10, checksum: "AA" })).unmount();
    await boot();
    h.tree.mockClear();
    (await open(1, "sdz", { size: 10, checksum: "AA" })).unmount();
    expect(h.tree).not.toHaveBeenCalled();
    await open(1, "sdz", { size: 11, checksum: "AA" });
    expect(h.tree).toHaveBeenCalledTimes(1);
  });

  it("ignores a stored cache with another version", async () => {
    (await open(1)).unmount();
    const raw = JSON.parse(storage.get("conquest.archiveListings") as string);
    storage.set(
      "conquest.archiveListings",
      JSON.stringify({ ...raw, version: raw.version + 1 }),
    );
    await boot();
    h.tree.mockClear();
    await open(1);
    expect(h.tree).toHaveBeenCalledTimes(1);
  });

  it("never stores a loose .sdd folder, which can be edited under the same name", async () => {
    (await open(CARRIER, "sdd")).unmount();
    expect(storage.get("conquest.archiveListings") ?? "").not.toContain(
      "game05_1.sdd",
    );
    await boot();
    h.tree.mockClear();
    await open(CARRIER, "sdd");
    expect(h.tree).toHaveBeenCalledTimes(1);
  });

  it("reads an .sdd again after a rescan, and a packaged game not at all", async () => {
    installed = [gameItem(1, "sdd"), gameItem(2)];
    const sdd = await open(1, "sdd");
    const packaged = await open(2);
    sdd.unmount();
    packaged.unmount();
    expect(h.tree).toHaveBeenCalledTimes(2);

    h.epoch = 1;
    await open(1, "sdd");
    await open(2);
    expect(treesRead()).toEqual([
      archiveOf(1, "sdd"),
      archiveOf(2),
      archiveOf(1, "sdd"),
    ]);
  });

  it("does not store an answer whose reads failed", async () => {
    h.file.mockRejectedValue(new Error("worker died"));
    (await open(CARRIER)).unmount();
    await boot();
    h.file.mockClear();
    h.tree.mockClear();
    await open(CARRIER);
    expect(h.tree).toHaveBeenCalledTimes(1);
  });
});

describe("the Conquest list and the drawer share one source", () => {
  it("counts the worker runs for a machine with 31 games", async () => {
    // First open, one game selected.
    (await open(CARRIER)).unmount();
    expect(h.tree).toHaveBeenCalledTimes(1);
    // Second open.
    (await open(CARRIER)).unmount();
    expect(h.tree).toHaveBeenCalledTimes(1);

    // The list searches every game, and reads the 30 the drawer did not.
    const list = renderHook(() => hooks.useHandmadeMaps());
    await waitFor(() => expect(list.result.current.loading).toBe(false));
    expect(h.tree).toHaveBeenCalledTimes(GAMES);
    expect(new Set(treesRead()).size).toBe(GAMES);
    // It and the drawer agree about the game that hides the styles.
    expect(list.result.current.onlyOwnMaps).toEqual(["Game 5 v1"]);
    list.unmount();

    // After a restart with the persisted cache warm, neither reads anything.
    await boot();
    h.tree.mockClear();
    const warm = renderHook(() => hooks.useHandmadeMaps());
    await waitFor(() => expect(warm.result.current.loading).toBe(false));
    (await open(CARRIER)).unmount();
    expect(h.tree).not.toHaveBeenCalled();
    expect(warm.result.current.onlyOwnMaps).toEqual(["Game 5 v1"]);
    expect(warm.result.current.maps).toHaveLength(1);
  });
});
