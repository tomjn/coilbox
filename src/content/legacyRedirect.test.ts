import { describe, expect, it } from "vitest";
import contentPlugin, { RENAMED_TO_LIBRARY } from "./index";
import { legacyTarget } from "./pages/LegacyRedirect";

/**
 * The `content/` to `library/` move is only safe if every live page kept a
 * retired twin. A player's bookmark, a link in a Discord message and the
 * provenance links already written into `content.replayState` all point at the
 * old paths, and none of them can be edited from here.
 */

describe("legacyTarget", () => {
  it("fills a single param", () => {
    expect(legacyTarget("/library/maps/:name", { name: "Isthmus" })).toBe(
      "/library/maps/Isthmus",
    );
  });

  it("fills every param in a multi-segment template", () => {
    expect(
      legacyTarget("/library/games/:name/units/:unit", {
        name: "Metal Factions",
        unit: "cornukesub",
      }),
    ).toBe("/library/games/Metal%20Factions/units/cornukesub");
  });

  it("fills a param not called name", () => {
    expect(legacyTarget("/library/blueprints/:id", { id: "a-b-c" })).toBe(
      "/library/blueprints/a-b-c",
    );
  });

  it("encodes a value the router handed back decoded", () => {
    expect(legacyTarget("/stats/:name", { name: "a b/c" })).toBe(
      "/stats/a%20b%2Fc",
    );
  });

  it("leaves a template with no params alone", () => {
    expect(legacyTarget("/downloads/maps", {})).toBe("/downloads/maps");
  });

  it("empties a token with no matching param rather than leaving the colon", () => {
    expect(legacyTarget("/library/maps/:name", {})).toBe("/library/maps/");
  });
});

/** Every `path` the content plugin registers, in declaration order. */
function pluginPaths(): string[] {
  return (contentPlugin.routes ?? []).flatMap((r) => (r.path ? [r.path] : []));
}

describe("the content to library move", () => {
  it("kept a retired twin for every renamed path", () => {
    const paths = new Set(pluginPaths());
    const missing = RENAMED_TO_LIBRARY.filter(
      (p) => !paths.has(`content/${p}`),
    );
    expect(missing, "renamed paths with no content/ redirect").toEqual([]);
  });

  it("registers a live library route for every renamed path", () => {
    const paths = new Set(pluginPaths());
    const missing = RENAMED_TO_LIBRARY.filter(
      (p) => !paths.has(`library/${p}`),
    );
    expect(missing, "listed as renamed but no live library/ route").toEqual([]);
  });

  it("lists every live library route as renamed", () => {
    // The other direction, so a page added under `library/` without an entry in
    // RENAMED_TO_LIBRARY is caught. A new page needs no redirect, but it must be
    // a deliberate omission rather than one nobody noticed.
    const live = pluginPaths()
      .filter((p) => p.startsWith("library/"))
      .map((p) => p.slice("library/".length));
    expect(live.sort()).toEqual([...RENAMED_TO_LIBRARY].sort());
  });

  it("left no live route under the old prefix", () => {
    // Everything still on `content/` redirects. The four that predate this move
    // (setup-packs, replays, stats) are redirects too.
    const stillContent = pluginPaths().filter((p) => p.startsWith("content/"));
    expect(stillContent.length).toBe(RENAMED_TO_LIBRARY.length + 5);
  });
});
