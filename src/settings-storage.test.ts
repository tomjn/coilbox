import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The write-through, and what waiting for it promises (issue #1674).
 *
 * The plugin's consent check reads the settings file rather than anything this
 * webview says, so "the switch has moved" and "the file says so" are two
 * different moments. `flush` is the second one.
 *
 * What a failed save then says to the person who made it is
 * `./settings-storage.dom.test.tsx`, which needs a DOM to read it off the
 * screen. It is stubbed here so this file stays about the queue.
 */

/** The Tauri commands, replaced by a save this test controls the timing of. */
const backend = vi.hoisted(() => {
  const saved: Record<string, string>[] = [];
  const waiting: { release: () => void; fail: () => void }[] = [];
  /** Let everything already scheduled run. Saves are chained, so the next one
   *  starts a turn after the one before it finished. */
  const tick = () => new Promise((done) => setTimeout(done, 0));
  return {
    saved,
    waiting,
    /** Finish the oldest save in flight, then let what it unblocked start. */
    async releaseOne() {
      await tick();
      waiting.shift()?.release();
      await tick();
    },
    async failOne() {
      await tick();
      waiting.shift()?.fail();
      await tick();
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: { entries: Record<string, string> }) => {
    if (command === "app_settings_load") return Promise.resolve({});
    backend.saved.push({ ...args?.entries });
    return new Promise((resolve, reject) => {
      backend.waiting.push({
        release: () => resolve(undefined),
        fail: () => reject(new Error("disk full")),
      });
    });
  },
}));

vi.mock("./notify/notify", () => ({ notify: vi.fn() }));

import { installSettingsStorage } from "./lib/storedSetting";
import { createTauriSettingsStorage } from "./settings-storage";

beforeEach(() => {
  backend.saved.length = 0;
  backend.waiting.length = 0;
  installSettingsStorage(null);
});

/** Whether `promise` has settled, without waiting for it to. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending");
  const winner = await Promise.race([
    promise.then(() => "done"),
    new Promise((done) => setTimeout(() => done(pending), 0)),
  ]);
  return winner !== pending;
}

describe("waiting for a settings write", () => {
  it("does not resolve until the save the value went into has", async () => {
    const storage = await createTauriSettingsStorage();
    storage.set("hub.assetUploads", "true");

    const written = storage.flush?.() ?? Promise.resolve();
    expect(await settled(written)).toBe(false);
    expect(backend.saved).toEqual([{ "hub.assetUploads": "true" }]);

    await backend.releaseOne();
    expect(await settled(written)).toBe(true);
  });

  it("waits for every write queued before it, not only the last", async () => {
    const storage = await createTauriSettingsStorage();
    storage.set("theme.accent", '"blue"');
    storage.set("hub.assetUploads", "true");

    const written = storage.flush?.() ?? Promise.resolve();
    await backend.releaseOne();
    expect(await settled(written)).toBe(false);

    await backend.releaseOne();
    expect(await settled(written)).toBe(true);
    // Each save carries the whole map, so the second one holds both answers.
    expect(backend.saved[1]).toEqual({
      "theme.accent": '"blue"',
      "hub.assetUploads": "true",
    });
  });

  it("resolves with nothing queued", async () => {
    const storage = await createTauriSettingsStorage();
    expect(await settled(storage.flush?.() ?? Promise.resolve())).toBe(true);
  });

  /**
   * A save that failed leaves the old answer in the file, which the plugin then
   * refuses on. So this resolves rather than rejects, and the next write still
   * happens: a rejected queue would take every later write down with it.
   */
  it("resolves when the save failed, and keeps writing after one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = await createTauriSettingsStorage();
    storage.set("hub.assetUploads", "true");
    const failed = storage.flush?.() ?? Promise.resolve();
    await backend.failOne();
    expect(await settled(failed)).toBe(true);

    storage.set("hub.assetUploads", "false");
    const written = storage.flush?.() ?? Promise.resolve();
    await backend.releaseOne();
    expect(await settled(written)).toBe(true);
    expect(backend.saved.at(-1)).toEqual({ "hub.assetUploads": "false" });
  });
});
