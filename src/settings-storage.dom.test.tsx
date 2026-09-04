// @vitest-environment happy-dom

/**
 * What a person sees when a setting will not save (issue #1701).
 *
 * `./settings-storage.test.ts` covers the write queue and what waiting on it
 * promises, with the notification mocked out. This drives the other half: a save
 * that rejects, through the real `notify()`, into the real toast host, and then
 * reads the words off the screen. Nothing between the failed write and the
 * rendered sentence is stubbed, because every part of that path is the fix.
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 * The rest of the settings storage suite has no React in it and is faster
 * without one.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { clearHistory, readHistory } from "@/notify/history";

/** The Tauri commands, replaced by a save this test controls the outcome of. */
const backend = vi.hoisted(() => {
  const waiting: { release: () => void; fail: () => void }[] = [];
  const tick = () => new Promise((done) => setTimeout(done, 0));
  return {
    waiting,
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

vi.mock("./uberstress/bindings", () => ({
  usSettingsLoad: async () => ({ entries: {} }),
  usSettingsSave: () =>
    new Promise((resolve, reject) => {
      backend.waiting.push({
        release: () => resolve({}),
        fail: () => reject(new Error("No space left on device")),
      });
    }),
}));

import { installSettingsStorage } from "./lib/storedSetting";
import { createTauriSettingsStorage } from "./settings-storage";

const TITLE = "Coilbox could not save your settings";

beforeEach(() => {
  backend.waiting.length = 0;
  installSettingsStorage(null);
  clearHistory();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  // sonner keeps its toasts in module state and replays the live ones to each
  // new host that subscribes, so a toast raised here would show up in the next
  // test's freshly mounted Toaster.
  toast.dismiss();
  vi.restoreAllMocks();
});

/** The app's toast host, mounted the way the notify plugin mounts it. */
function mountToasts() {
  render(
    <PersistentStoreProvider storage={memoryStorage()}>
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

/** How many toasts on screen carry the failed-save title. */
const shown = () => screen.queryAllByText(TITLE).length;

describe("a setting that would not save", () => {
  it("says so on screen, in words that say what to do about it", async () => {
    mountToasts();
    const storage = await createTauriSettingsStorage();
    storage.set("hub.assetUploads", "true");
    await backend.failOne();

    await waitFor(() => expect(shown()).toBe(1));
    expect(
      screen.getByText(
        "Your change will be lost when Coilbox closes, and anything that reads the settings file still has the old answer. Check the disk is not full, then change the setting again to try saving it.",
      ),
    ).toBeTruthy();
  });

  it("leaves it in the bell, so it survives the toast going away", async () => {
    mountToasts();
    const storage = await createTauriSettingsStorage();
    storage.set("hub.assetUploads", "true");
    await backend.failOne();

    await waitFor(() => expect(readHistory().entries.length).toBe(1));
    expect(readHistory().entries[0]).toMatchObject({
      title: TITLE,
      level: "error",
    });
  });

  it("says nothing when the save worked", async () => {
    mountToasts();
    const storage = await createTauriSettingsStorage();
    storage.set("hub.assetUploads", "true");
    await backend.releaseOne();

    expect(await storage.flush?.()).toBeUndefined();
    expect(shown()).toBe(0);
    expect(readHistory().entries).toHaveLength(0);
  });

  /**
   * A disk that has stopped taking writes fails every setting anybody touches
   * after it, and a toast each is a wall of the same sentence.
   */
  it("says it once while the saves keep failing", async () => {
    mountToasts();
    const storage = await createTauriSettingsStorage();
    storage.set("hub.assetUploads", "true");
    await backend.failOne();
    storage.set("theme.accent", '"blue"');
    await backend.failOne();

    await waitFor(() => expect(shown()).toBe(1));
    expect(readHistory().entries).toHaveLength(1);
  });

  /** Said again once saving has worked since, because it is news again. */
  it("says it again after a save that worked", async () => {
    mountToasts();
    const storage = await createTauriSettingsStorage();
    storage.set("hub.assetUploads", "true");
    await backend.failOne();
    await waitFor(() => expect(readHistory().entries).toHaveLength(1));

    storage.set("theme.accent", '"blue"');
    await backend.releaseOne();
    storage.set("theme.accent", '"red"');
    await backend.failOne();

    await waitFor(() => expect(readHistory().entries).toHaveLength(2));
  });
});
