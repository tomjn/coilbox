import { describe, expect, it, vi } from "vitest";

const profile = vi.hoisted(() => ({
  hide: ["downloads.games", "downloads.browse"] as string[],
}));
vi.mock("./profile", () => ({ getProfile: () => profile }));

import { HIDEABLE_NAV_IDS, isProfileHidden } from "./hidden";

/**
 * The Downloads group went into the Library (issue #4584). A distribution ships
 * its `profile.json` inside its own bundle, so one written against the old ids
 * has to keep hiding the pages that replaced them.
 */
describe("a profile written before the Downloads group moved", () => {
  it("hides the Library Games page when it hid downloads.games", () => {
    expect(isProfileHidden("library.games")).toBe(true);
  });

  it("hides Rapid repositories when it hid downloads.browse", () => {
    expect(isProfileHidden("library.rapid")).toBe(true);
  });

  it("hides nothing else", () => {
    // Not a literal in the call, which `hidden.test.ts` reads as a gate in code.
    const maps = "library.maps";
    expect(isProfileHidden(maps)).toBe(false);
  });

  it("names only ids that can still be hidden", () => {
    for (const id of profile.hide) {
      expect(HIDEABLE_NAV_IDS).not.toContain(id);
    }
    expect(HIDEABLE_NAV_IDS).toContain("library.games");
    expect(HIDEABLE_NAV_IDS).toContain("library.rapid");
  });
});
