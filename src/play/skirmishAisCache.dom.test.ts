// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memorySettingsStorage } from "../lib/storedSetting";

/**
 * The skirmish AI list for a game is kept per archive, and across a restart for
 * a packaged one (issue #3674). The key holds the engine folder, because the
 * list holds the engine's own AIs as well as the game's.
 */

const h = vi.hoisted(() => ({
  ais: vi.fn(),
  epoch: 0,
}));

vi.mock("../content/bindings", async (orig) => ({
  ...(await orig<typeof import("../content/bindings")>()),
  unitsyncSkirmishAis: h.ais,
}));
vi.mock("../content/config", async (orig) => ({
  ...(await orig<typeof import("../content/config")>()),
  useScanEpoch: () => h.epoch,
}));

let storage = memorySettingsStorage();
let useSkirmishAis: typeof import("./config").useSkirmishAis;

/** Start the app: a fresh module graph over the settings that survived. */
async function boot() {
  vi.resetModules();
  const stored = await import("../lib/storedSetting");
  stored.installSettingsStorage(storage);
  ({ useSkirmishAis } = await import("./config"));
}

async function load(engine: string, archive: string) {
  const view = renderHook(() => useSkirmishAis(engine, "/data", archive));
  await waitFor(() => expect(view.result.current.loaded).toBe(true));
  return view;
}

beforeEach(async () => {
  h.epoch = 0;
  storage = memorySettingsStorage();
  h.ais.mockReset().mockResolvedValue({
    ais: [{ shortName: "NullAI", version: "1", name: "NullAI" }],
    errors: [],
  });
  await boot();
});

afterEach(cleanup);

describe("the skirmish AI list cache", () => {
  it("reads a game once, and a second open reads nothing", async () => {
    (await load("/engine/105", "game_1.sdz")).unmount();
    const again = await load("/engine/105", "game_1.sdz");
    expect(h.ais).toHaveBeenCalledTimes(1);
    expect(again.result.current.ais).toHaveLength(1);
  });

  it("answers from the stored cache after a restart", async () => {
    (await load("/engine/105", "game_1.sdz")).unmount();
    await boot();
    h.ais.mockClear();
    const view = await load("/engine/105", "game_1.sdz");
    expect(h.ais).not.toHaveBeenCalled();
    expect(view.result.current.ais.map((a) => a.shortName)).toEqual(["NullAI"]);
  });

  it("reads again for another engine, since its own AIs differ", async () => {
    (await load("/engine/105", "game_1.sdz")).unmount();
    await boot();
    h.ais.mockClear();
    await load("/engine/106", "game_1.sdz");
    expect(h.ais).toHaveBeenCalledTimes(1);
  });

  it("reads again when the archive name changes", async () => {
    (await load("/engine/105", "game_1.sdz")).unmount();
    await boot();
    h.ais.mockClear();
    await load("/engine/105", "game_2.sdz");
    expect(h.ais).toHaveBeenCalledTimes(1);
  });

  it("ignores a stored cache with another version", async () => {
    (await load("/engine/105", "game_1.sdz")).unmount();
    const raw = JSON.parse(storage.get("play.skirmishAis") as string);
    storage.set(
      "play.skirmishAis",
      JSON.stringify({ ...raw, version: raw.version + 1 }),
    );
    await boot();
    h.ais.mockClear();
    await load("/engine/105", "game_1.sdz");
    expect(h.ais).toHaveBeenCalledTimes(1);
  });

  it("keeps a loose .sdd folder for the session only, and reads it again after a rescan", async () => {
    (await load("/engine/105", "game_1.sdd")).unmount();
    expect(storage.get("play.skirmishAis") ?? "").not.toContain("game_1.sdd");
    h.epoch = 1;
    await load("/engine/105", "game_1.sdd");
    expect(h.ais).toHaveBeenCalledTimes(2);

    await boot();
    h.ais.mockClear();
    await load("/engine/105", "game_1.sdd");
    expect(h.ais).toHaveBeenCalledTimes(1);
  });

  it("does not store a list that came with diagnostics", async () => {
    h.ais.mockResolvedValue({ ais: [], errors: ["could not read an AI"] });
    (await load("/engine/105", "game_1.sdz")).unmount();
    await boot();
    h.ais.mockClear();
    await load("/engine/105", "game_1.sdz");
    expect(h.ais).toHaveBeenCalledTimes(1);
  });
});
