import { describe, expect, it } from "vitest";
import downloadsPlugin, { RETIRED_DOWNLOADS_PATHS } from "./index";

// Reaching the plugin list means importing every plugin, and a few register
// listeners on `window` as they load. Tests run in node, so hand them somewhere
// harmless to register, exactly as `settingsTree.test.ts` does.
Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {} },
});

const { plugins } = await import("../app.plugins");

/**
 * The Downloads group went into the Library (issue #4584). A player's bookmark, a
 * link in a Discord message, a `coilbox://import` link for a setup pack and a
 * notification already in the history all point at the old paths, and none of
 * them can be edited from here.
 */

/** Every `path` the downloads plugin registers, in declaration order. */
function pluginPaths(): string[] {
  return (downloadsPlugin.routes ?? []).flatMap((r) =>
    r.path ? [r.path] : [],
  );
}

describe("the retired downloads paths", () => {
  it("redirect to the Library page that replaced each", () => {
    expect(RETIRED_DOWNLOADS_PATHS).toEqual({
      downloads: "/library/downloads",
      "downloads/maps": "/library/maps",
      "downloads/games": "/library/games",
    });
  });

  it("each have a registered route", () => {
    const paths = new Set(pluginPaths());
    const missing = Object.keys(RETIRED_DOWNLOADS_PATHS).filter(
      (p) => !paths.has(p),
    );
    expect(missing, "retired paths with no redirect route").toEqual([]);
  });

  it("leave no live page under the old prefix", () => {
    const under = pluginPaths().filter(
      (p) => p === "downloads" || p.startsWith("downloads/"),
    );
    expect(under.sort()).toEqual(Object.keys(RETIRED_DOWNLOADS_PATHS).sort());
  });

  it("send every target to a path some plugin serves", () => {
    const served = new Set(
      plugins.flatMap((p) => p.routes?.map((r) => `/${r.path}`) ?? []),
    );
    for (const target of Object.values(RETIRED_DOWNLOADS_PATHS)) {
      expect(served.has(target), target).toBe(true);
    }
  });
});
