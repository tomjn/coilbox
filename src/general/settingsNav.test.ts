import type { FramePlugin, NavGroup } from "@picoframe/plugin-sdk";
import { describe, expect, it } from "vitest";

// Reaching the plugin list means importing every plugin, and a few register
// listeners on `window` as they load. Tests run in node, so hand them somewhere
// harmless to register, exactly as `settingsTree.test.ts` does.
Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {} },
});

const { plugins } = await import("../app.plugins");

/**
 * The Settings group links to settings sections rather than to routes of its
 * own, which is what keeps it free of new routes but also means nothing in the
 * router can catch a typo. A card pointing at `/settings/lobby-server` would
 * render happily and land on an empty page.
 */

const all = plugins as FramePlugin[];

function group(id: string): NavGroup {
  const found = all.flatMap((p) => p.nav ?? []).find((g) => g.id === id);
  if (!found) throw new Error(`no ${id} nav group`);
  return found;
}

/** Every settings section id the app registers. */
const sectionIds = new Set(
  all.flatMap((p) => p.settings ?? []).map((s) => s.id),
);

describe("the Settings nav group", () => {
  it("points every item at a settings section that exists", () => {
    const dead = group("settings")
      .items.map((i) => i.to)
      .filter((to): to is string => !!to && to !== "/settings")
      .filter((to) => !sectionIds.has(to.slice("/settings/".length)));
    expect(dead, "links to no such settings section").toEqual([]);
  });

  it("sorts below every other group", () => {
    const groups = all.flatMap((p) => p.nav ?? []);
    const others = groups
      .filter((g) => g.id !== "settings")
      .map((g) => g.order ?? 100);
    expect(group("settings").order ?? 100).toBeGreaterThan(Math.max(...others));
  });

  it("adds no routes, so the group cannot drift from docs/routes.md", () => {
    // `routesDoc.test.ts` checks `path`, not `to`. If this group ever grows a
    // route it has to be documented, and this is the reminder.
    const general = all.find((p) => p.id === "general");
    expect(general?.routes ?? []).toEqual([]);
  });
});
