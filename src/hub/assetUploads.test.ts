import { afterEach, describe, expect, it, vi } from "vitest";

// assetUploads.ts reaches @picoframe/frame and, through profile.ts,
// @picoframe/plugin-sdk. Both published dists use extensionless relative imports
// Vitest's node resolver won't load from node_modules, so the leaves are stubbed
// the same way config.test.ts does. Nothing here renders, so the stubbed
// useSetting is never called.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [false, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import {
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import { getProfile } from "../profile/profile";
import {
  ASSET_UPLOAD_SETTING_KEY,
  assetUploadsAllowed,
  assetUploadsPermitted,
} from "./assetUploads";

// The loaded-profile singleton is mutated and put back, the way profile/hub.test.ts
// does: the module loads its profile once per session, so there's no other way in.
afterEach(() => {
  const loaded = getProfile();
  loaded.hub = undefined;
  loaded.hubAssetUploads = undefined;
  installSettingsStorage(null);
});

/** Install a settings store holding `agreed` under the upload key. */
function storeAnswer(agreed: boolean | undefined) {
  const storage = memorySettingsStorage();
  if (agreed !== undefined)
    storage.set(ASSET_UPLOAD_SETTING_KEY, JSON.stringify(agreed));
  installSettingsStorage(storage);
}

describe("assetUploadsAllowed", () => {
  it("says no until the player has agreed", () => {
    expect(assetUploadsAllowed(false, true)).toBe(false);
    expect(assetUploadsAllowed(true, true)).toBe(true);
  });

  it("lets a distribution refuse what the player agreed to", () => {
    expect(assetUploadsAllowed(true, false)).toBe(false);
  });
});

describe("assetUploadsPermitted", () => {
  it("is off on a fresh install, with nothing stored", () => {
    storeAnswer(undefined);
    expect(assetUploadsPermitted()).toBe(false);
  });

  it("is off for a player who turned it off again", () => {
    storeAnswer(false);
    expect(assetUploadsPermitted()).toBe(false);
  });

  it("is on once the player has turned it on", () => {
    storeAnswer(true);
    expect(assetUploadsPermitted()).toBe(true);
  });

  it("is off when the profile switched uploads off, however the setting reads", () => {
    storeAnswer(true);
    getProfile().hubAssetUploads = false;
    expect(assetUploadsPermitted()).toBe(false);
  });

  it("is off when the profile switched the whole hub off", () => {
    storeAnswer(true);
    getProfile().hub = false;
    expect(assetUploadsPermitted()).toBe(false);
  });

  it("still needs the player's answer when the profile allows uploads", () => {
    storeAnswer(undefined);
    getProfile().hubAssetUploads = true;
    expect(assetUploadsPermitted()).toBe(false);
    storeAnswer(true);
    expect(assetUploadsPermitted()).toBe(true);
  });

  // The plugin reads this exact key out of the frame's settings file, so a rename
  // here without one there is a setting that silently never takes effect.
  it("stores the answer under the key the plugin reads", () => {
    expect(ASSET_UPLOAD_SETTING_KEY).toBe("hub.assetUploads");
  });
});
