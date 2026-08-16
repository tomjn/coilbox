import { afterEach, describe, expect, it, vi } from "vitest";

// assetUploads.ts reaches @picoframe/frame and, through profile.ts,
// @picoframe/plugin-sdk. Both published dists use extensionless relative imports
// Vitest's node resolver won't load from node_modules, so the leaves are stubbed
// the same way config.test.ts does. Nothing here renders, so the stub stands in
// for the frame's store: the consent test below points it at a storage of its
// own and calls the hook directly, which works because this is the only hook it
// uses.
const frame = vi.hoisted(() => ({
  useSetting: (
    _key: string,
    fallback: boolean,
  ): [boolean, (next: boolean) => void] => [fallback, () => {}],
}));
vi.mock("@picoframe/frame", () => ({
  useSetting: (key: string, fallback: boolean) =>
    frame.useSetting(key, fallback),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import {
  type FlushableSettingsStorage,
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import { getProfile } from "../profile/profile";
import {
  ASSET_UPLOAD_SETTING_KEY,
  assetUploadsAllowed,
  assetUploadsPermitted,
  useAssetUploadConsent,
} from "./assetUploads";

// The loaded-profile singleton is mutated and put back, the way profile/hub.test.ts
// does: the module loads its profile once per session, so there's no other way in.
afterEach(() => {
  const loaded = getProfile();
  loaded.hub = undefined;
  loaded.hubAssetUploads = undefined;
  installSettingsStorage(null);
  frame.useSetting = (_key, fallback) => [fallback, () => {}];
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

describe("agreeing to send pictures", () => {
  // The gate that matters reads the settings file, so the moment the switch
  // moves and the moment the file says so are different ones (issue #1674).
  it("resolves once the answer is written, not once the switch has moved", async () => {
    const entries = new Map<string, string>();
    let land = () => {};
    const write = new Promise<void>((done) => {
      land = done;
    });
    const storage: FlushableSettingsStorage = {
      get: (key) => entries.get(key) ?? null,
      set: (key, value) => {
        entries.set(key, value);
      },
      flush: () => write,
    };
    installSettingsStorage(storage);
    frame.useSetting = (key) => [
      false,
      (next) => storage.set(key, JSON.stringify(next)),
    ];

    const [, agree] = useAssetUploadConsent();
    let saved = false;
    const saving = agree(true).then(() => {
      saved = true;
    });

    // The cache has the answer immediately, which is what the frontend's own
    // advisory check reads. The promise is about the file.
    expect(assetUploadsPermitted()).toBe(true);
    await new Promise((done) => setTimeout(done, 0));
    expect(saved).toBe(false);

    land();
    await saving;
    expect(saved).toBe(true);
  });
});
