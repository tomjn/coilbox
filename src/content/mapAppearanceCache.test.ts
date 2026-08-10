import { describe, expect, it, vi } from "vitest";

// mapAppearanceCache.ts imports `useSetting` from @picoframe/frame, whose
// published dist uses extensionless relative imports Vitest's node resolver won't
// load. The hook is never called here, so stubbing the leaf is enough to let the
// module import (same pattern as channels.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));

import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../lib/storedSetting";
import type { MapAppearance } from "../mapconv/bindings";
import { MAP_APPEARANCE_KEY, type MapAppearanceCache } from "./mapAppearance";
import { recordMapAppearance } from "./mapAppearanceCache";

const appearance = (voidWater: boolean) => ({ voidWater }) as MapAppearance;

describe("recordMapAppearance", () => {
  /** Set up a store, and the setter `useSetting` hands a caller back. */
  function bank() {
    const storage = memorySettingsStorage();
    installSettingsStorage(storage);
    return {
      write: (next: MapAppearanceCache) =>
        storage.set(MAP_APPEARANCE_KEY, JSON.stringify(next)),
      stored: () =>
        readStoredSetting<MapAppearanceCache>(MAP_APPEARANCE_KEY, {}),
    };
  }

  it("banks every map when a list of minimaps resolves in one pass", () => {
    // What a battle list does: one mounted minimap per battle, each resolving
    // from the warm session cache inside its effect, so every write lands before
    // any re-render (issue #1374).
    const { write, stored } = bank();
    recordMapAppearance("Comet Catcher", appearance(false), write);
    recordMapAppearance("Nuclear Winter", appearance(true), write);
    recordMapAppearance("Supreme Isthmus", appearance(false), write);
    expect(Object.keys(stored()).sort()).toEqual([
      "Comet Catcher",
      "Nuclear Winter",
      "Supreme Isthmus",
    ]);
  });

  it("leaves a map already in the cache alone", () => {
    const { write, stored } = bank();
    recordMapAppearance("Comet Catcher", appearance(true), write);
    recordMapAppearance("Comet Catcher", appearance(false), write);
    expect(stored()["Comet Catcher"].voidWater).toBe(true);
  });
});
