import { describe, expect, it, vi } from "vitest";

// profile.ts transitively pulls in @picoframe/plugin-sdk, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load. The flag
// never invokes a command, so stubbing the leaf lets the module load (same shim as
// updater.test.ts).
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { getProfile, isHubEnabled } from "./profile";

// Mutates the loaded-profile singleton the way updater.test.ts does, then restores
// it: the module loads its profile once per session, so there's no other way in.
describe("isHubEnabled", () => {
  it("is on for a vanilla build and for a profile that stays silent", () => {
    expect(isHubEnabled()).toBe(true);
  });

  it("is off only for an explicit hub: false", () => {
    const loaded = getProfile();
    loaded.hub = false;
    expect(isHubEnabled()).toBe(false);
    loaded.hub = true;
    expect(isHubEnabled()).toBe(true);
    loaded.hub = undefined;
  });
});
