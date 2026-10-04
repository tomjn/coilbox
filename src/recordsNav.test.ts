import type { FramePlugin, NavGroup } from "@picoframe/plugin-sdk";
import { describe, expect, it } from "vitest";
// The frame does not export its breadcrumb builder, so reach it by path, the
// way `general/contentScroll.test.ts` reaches the frame's layout.
import {
  buildCrumbResolvers,
  buildCrumbTrail,
} from "../node_modules/@picoframe/frame/dist/routing/crumbs.js";

// Reaching the plugin list means importing every plugin, and a few register
// listeners on `window` as they load (same shim as `settingsTree.test.ts`).
Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {} },
});

const { plugins } = await import("./app.plugins");

/**
 * The sidebar model, merged the way picoframe's `composeNav` merges it: groups
 * with the same id join, items sort by `order` inside a group and groups sort
 * by `order` among themselves (both default 100).
 */
function composedNav(): NavGroup[] {
  const groups = new Map<string, NavGroup>();
  for (const p of plugins as FramePlugin[]) {
    for (const g of p.nav ?? []) {
      const target = groups.get(g.id);
      if (target) {
        target.label ??= g.label;
        target.order ??= g.order;
        target.items.push(...g.items);
      } else {
        groups.set(g.id, { ...g, items: [...g.items] });
      }
    }
  }
  const result = [...groups.values()];
  for (const g of result) {
    g.items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  return result.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

const nav = composedNav();
const groupIds = nav.map((g) => g.id);

function group(id: string): NavGroup {
  const g = nav.find((x) => x.id === id);
  if (!g) throw new Error(`no nav group ${id}`);
  return g;
}

describe("the Records nav group", () => {
  it("holds Career, Player stats and Replays in that order", () => {
    const items = group("records").items.map((i) => [i.id, i.label, i.to]);
    expect(items).toEqual([
      ["career.overview", "Career", "/career"],
      ["multiplayer.stats", "Player stats", "/stats"],
      ["play.replays", "Replays", "/play/replays"],
    ]);
  });

  it("is labelled Records", () => {
    expect(group("records").label).toBe("Records");
  });

  it("sits after Multiplayer and before Library", () => {
    const play = groupIds.indexOf("play");
    const multiplayer = groupIds.indexOf("multiplayer");
    const records = groupIds.indexOf("records");
    const library = groupIds.indexOf("library");
    expect(play).toBeLessThan(multiplayer);
    expect(multiplayer).toBeLessThan(records);
    expect(records).toBeLessThan(library);
    expect(records).toBe(multiplayer + 1);
  });

  it("takes the three items out of Play and Multiplayer", () => {
    const moved = new Set([
      "career.overview",
      "multiplayer.stats",
      "play.replays",
    ]);
    for (const id of ["play", "multiplayer"]) {
      const left = group(id).items.filter((i) => moved.has(i.id));
      expect(left, `${id} still lists moved items`).toEqual([]);
    }
  });

  it("leaves Save Games under Play", () => {
    expect(group("play").items.map((i) => i.id)).toContain("play.savegames");
  });
});

describe("breadcrumbs for the Records pages", () => {
  const resolvers = buildCrumbResolvers(plugins as FramePlugin[]);
  const trail = (path: string) =>
    buildCrumbTrail(resolvers, path).crumbs.map(
      (c: { label: string }) => c.label,
    );

  it("reads Career for the Career page", () => {
    expect(trail("/career")).toEqual(["Career"]);
  });

  it("reads Player stats for the stats list, then the player", () => {
    expect(trail("/stats")).toEqual(["Player stats"]);
    expect(trail("/stats/Alice")).toEqual(["Player stats", "Alice"]);
  });

  it("reads Replays for the replay list, with no Play ancestor", () => {
    expect(trail("/play/replays")).toEqual(["Replays"]);
  });

  it("reads Replays then the replay for a replay's page", () => {
    expect(trail("/play/replays/a%20demo.sdfz")).toEqual([
      "Replays",
      "a demo.sdfz",
    ]);
  });
});
