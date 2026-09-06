import type { FramePlugin } from "@picoframe/plugin-sdk";
import { describe, expect, it } from "vitest";
import { canonicalProfileId, RENAMED_PROFILE_IDS } from "./renamedIds";

// Reaching the plugin list means importing every plugin, and a few register
// listeners on `window` as they load. Tests run in node, so hand them somewhere
// harmless to register, exactly as `settingsTree.test.ts` does.
Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {} },
});

const { plugins } = await import("../app.plugins");

/**
 * The rename map is the only thing standing between a shipped distribution and
 * a `profile.json` that silently stops working. A distribution bundles that file
 * itself, so nothing in this repo can migrate it, and a broken entry shows up as
 * a feature quietly reappearing rather than as an error.
 *
 * These read the real plugin list, so an id that moves again without an entry
 * here fails rather than shipping.
 */

/** Every nav group id and nav item id the app registers. */
function navIds(): Set<string> {
  const ids = new Set<string>();
  for (const p of plugins as FramePlugin[]) {
    for (const group of p.nav ?? []) {
      ids.add(group.id);
      for (const item of group.items) ids.add(item.id);
    }
  }
  return ids;
}

/** Every settings section id the app registers. */
function settingsIds(): Set<string> {
  const ids = new Set<string>();
  for (const p of plugins as FramePlugin[]) {
    for (const section of p.settings ?? []) ids.add(section.id);
  }
  return ids;
}

describe("canonicalProfileId", () => {
  it("maps a renamed id to its current name", () => {
    expect(canonicalProfileId("content.games")).toBe("library.games");
    expect(canonicalProfileId("content")).toBe("library");
  });

  it("passes an id it does not know straight through", () => {
    expect(canonicalProfileId("downloads.games")).toBe("downloads.games");
    expect(canonicalProfileId("nonsense")).toBe("nonsense");
  });

  it("passes an id that shadows the prototype straight through", () => {
    // An author's typo must miss like any other, not resolve an inherited
    // Object property and hand a non-string back to the caller.
    expect(canonicalProfileId("__proto__")).toBe("__proto__");
    expect(canonicalProfileId("constructor")).toBe("constructor");
  });

  it("kept content.setupPacks, which never named a nav item", () => {
    expect(canonicalProfileId("content.setupPacks")).toBe("content.setupPacks");
  });
});

describe("RENAMED_PROFILE_IDS", () => {
  it("points every old id at one the app actually registers", () => {
    const live = new Set([...navIds(), ...settingsIds()]);
    const dangling = [...RENAMED_PROFILE_IDS.values()].filter(
      (id) => !live.has(id),
    );
    expect(dangling, "renamed to an id nothing registers").toEqual([]);
  });

  it("has no old id that is still a live id", () => {
    // An entry whose key is also registered would rewrite a working id into a
    // different feature, which is worse than no entry at all.
    const live = new Set([...navIds(), ...settingsIds()]);
    const collisions = [...RENAMED_PROFILE_IDS.keys()].filter((id) =>
      live.has(id),
    );
    expect(collisions, "old id still in use").toEqual([]);
  });
});
