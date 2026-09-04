import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Reaching the plugin list means importing every plugin, and a few of them
// register listeners on `window` as they load (chat's mention cue, for one).
// Tests run in node, so hand them somewhere harmless to register (same shim
// as settingsTree.test.ts).
Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {} },
});

const { plugins } = await import("./app.plugins");

/**
 * docs/routes.md is a hand-written mirror of every plugin's `routes` array.
 * Issue #2430 found it 13 routes behind the code, drift nobody noticed because
 * nothing checked it. This reads the same `plugins` array app.plugins.ts feeds
 * picoframe, so a route that ships with no line in the doc fails here instead
 * of drifting silently again.
 *
 * A path counts as documented if it appears as a link, backtick-wrapped so
 * `#/battle` can't pass on the strength of `#/battles` existing elsewhere. The
 * one exception is the four legacy `content/replays(/:name)`-style redirects
 * in "Old paths", which the doc deliberately writes as one parenthesised line
 * per pair rather than as four separate rows.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const routesDoc = readFileSync(join(REPO, "docs", "routes.md"), "utf8");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDocumented(path: string): boolean {
  // A plain link: `#/content/maps`. Bounded on the right so `#/battle` can't
  // pass on the strength of `#/battles` existing elsewhere, and also matches
  // the base of a `#/content/replays(/:name)` shorthand link, whose next
  // character after the base path is `(` rather than a closing backtick.
  if (new RegExp(`\`#/${escapeRegExp(path)}[\`(]`).test(routesDoc)) return true;
  // The other half of that shorthand: a `:param` route documented as
  // `#/content/replays(/:name)` rather than its own `#/content/replays/:name`
  // row.
  const shorthand = path.replace(/\/(:\w+)$/, "(/$1)");
  if (shorthand === path) return false;
  return routesDoc.includes(`\`#/${shorthand}\``);
}

// `path` is absent on picoframe's own built-in index route (`/`, from
// `framePlugin`). Nothing this doc is meant to track, since it isn't
// declared in `src/*/index.ts*`.
const paths = plugins
  .flatMap((p) => p.routes?.map((r) => r.path) ?? [])
  .filter((path): path is string => Boolean(path));

describe("docs/routes.md", () => {
  it("found routes to check against", () => {
    // A guard on the extraction itself: a plugin list that stopped yielding
    // routes would otherwise pass this suite by finding nothing to check.
    expect(paths.length).toBeGreaterThan(40);
  });

  it.each(paths)("documents %s", (path) => {
    expect(isDocumented(path)).toBe(true);
  });
});
