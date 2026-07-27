import { describe, expect, it, vi } from "vitest";

// profile.ts transitively pulls in @picoframe/plugin-sdk, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load. The flag
// never invokes a command, so stubbing the leaf lets the module load (same shim as
// layout.test.ts).
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { getProfile, isUpdaterEnabled } from "./profile";

// Mutates the loaded-profile singleton the way layout.test.ts does, then restores
// it: the module loads its profile once per session, so there's no other way in.
describe("isUpdaterEnabled", () => {
  it("is on for a vanilla build and for a profile that stays silent", () => {
    expect(isUpdaterEnabled()).toBe(true);
  });

  it("is off only for an explicit updater: false", () => {
    const loaded = getProfile();
    loaded.updater = false;
    expect(isUpdaterEnabled()).toBe(false);
    loaded.updater = true;
    expect(isUpdaterEnabled()).toBe(true);
    loaded.updater = undefined;
  });
});
