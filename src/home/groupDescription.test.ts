import type { FramePlugin, NavGroup } from "@picoframe/plugin-sdk";
import { describe, expect, it } from "vitest";
import { describedGroupIds, groupDescription } from "./groupDescription";
import { homeToolGroups } from "./nav";

// Reaching the plugin list means importing every plugin, and a few register
// listeners on `window` as they load. Tests run in node, so hand them somewhere
// harmless to register, exactly as `settingsTree.test.ts` does.
Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {} },
});

const { plugins } = await import("../app.plugins");

/**
 * The groups the welcome page actually draws.
 *
 * Merged by id the way `composeNav` merges them, then put through the same
 * filter the grid uses. That drops the frame's own `main` group, whose only item
 * is Home: the grid strips it, so it never gets a heading to describe.
 */
function drawnGroupIds(): Set<string> {
  const merged = new Map<string, NavGroup>();
  for (const p of plugins as FramePlugin[]) {
    for (const g of p.nav ?? []) {
      const existing = merged.get(g.id);
      if (existing) existing.items.push(...g.items);
      else merged.set(g.id, { ...g, items: [...g.items] });
    }
  }
  return new Set(homeToolGroups([...merged.values()]).map((g) => g.id));
}

const groupIds = drawnGroupIds();

describe("groupDescription", () => {
  it("describes every group the app registers", () => {
    // A new group shipping without a line is the regression this catches. The
    // welcome page would draw a bare heading among described ones.
    const missing = [...groupIds].filter((id) => !groupDescription(id));
    expect(missing, "nav groups with no description").toEqual([]);
  });

  it("describes nothing the app does not register", () => {
    // The other direction: a line left behind after a group was renamed reads
    // as working and shows nowhere.
    const dead = describedGroupIds().filter((id) => !groupIds.has(id));
    expect(dead, "described but no such nav group").toEqual([]);
  });

  it("returns nothing for a group it does not know", () => {
    // The link groups a distribution injects through `profile.links`.
    expect(groupDescription("some-distribution-links")).toBeUndefined();
  });

  it("returns nothing for a group id that shadows the prototype", () => {
    expect(groupDescription("__proto__")).toBeUndefined();
    expect(groupDescription("constructor")).toBeUndefined();
    expect(groupDescription("toString")).toBeUndefined();
  });
});
