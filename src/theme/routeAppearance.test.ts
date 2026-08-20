import type { FrameRoute } from "@picoframe/plugin-sdk";
import { describe, expect, it } from "vitest";

// Reaching the plugin list means importing every plugin, and a few of them
// register listeners on `window` as they load. Tests run in node, so hand them
// somewhere harmless to register, the way `src/settingsTree.test.ts` does.
Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {} },
});

const { plugins } = await import("../app.plugins");

/**
 * Every route in the app that overrides the player's theme, read off the real
 * plugin list (#1828).
 *
 * Three screens force the dark ramp. Each is text over full-bleed artwork that
 * is dark whatever the player picked, so following a light theme there is not a
 * theme, it is unreadable text on a picture. That was #1809 and #1785, five
 * rounds of contrast fixes between them.
 *
 * The forcing is one line on a route object, and deleting it has no symptom any
 * other test can see. The screen goes back to the player's theme, and only a
 * person looking at it notices. `src/theme/routeAppearance.dom.test.tsx` checks
 * what the forcing does to the document, not which routes ask for it.
 *
 * This is a list, and #1828 asked whether it should instead be derived from what
 * a route renders. It should not, because nothing in the code says that a
 * screen's artwork is dark:
 *
 * - Full-bleed art is not the signal. `src/profile/CustomPage.tsx` paints a
 *   full-bleed background from a distribution's own image and has to keep
 *   following the player's theme, because nobody here knows what that image is.
 *   `GameHeader` paints a full-bleed hero on an ordinary content page.
 * - A shared component is not the signal either. The two maps do share one,
 *   `GalaxyView`, which is what `hudChrome.test.ts` keys on. The briefing draws
 *   a panorama, a 3D map, a 3D unit or a gradient, and shares none of it.
 *
 * So deriving it means each of these screens saying a second time that its
 * backdrop is dark, in some form a test can read, and forgetting that second
 * declaration fails exactly the way forgetting the first one does. Three routes
 * do not pay for a mechanism whose own line somebody can drop.
 *
 * What this does buy over a test naming the three page files: it reads the whole
 * route table, every plugin and every nested child. A route anywhere in the app
 * that gains or loses a forcing fails here, and the message says which way to
 * fix it.
 *
 * The one thing it cannot catch is a new screen that needs the forcing and never
 * asks for it. Only the person who built the screen can see that.
 */

/** The routes that force an appearance, and what makes each one need it. */
const FORCED = [
  // The mission briefing: an authored panorama, a lit 3D map, a lit 3D unit, or
  // the slate gradient it falls back to when it has none of those. All four are
  // dark, and the briefing card sits on top of them.
  "campaign/:id/:missionId: dark",
  // The conquest galaxy: a starfield with a HUD over it, which has no light
  // version to draw.
  "conquest/:id: dark",
  // The warpath map: the same starfield through the same renderer, built from a
  // run rather than a galaxy document.
  "warpath/:runId: dark",
];

/** Every route the app declares, each carrying its parents' segments in front. */
function flatten(
  routes: FrameRoute[],
  prefix = "",
): { path: string; appearance?: string }[] {
  return routes.flatMap((route) => {
    const path = [prefix, route.path ?? ""].filter(Boolean).join("/");
    return [
      { path, appearance: route.appearance },
      ...flatten(route.children ?? [], path),
    ];
  });
}

describe("the routes that override the player's theme", () => {
  it("is the three screens whose artwork is dark whatever the player picked", () => {
    const forced = flatten(plugins.flatMap((p) => p.routes))
      .filter((route) => route.appearance)
      .map((route) => `${route.path}: ${route.appearance}`)
      .sort();

    expect(
      forced,
      "A route's `appearance` overrides the player's own theme, and the list " +
        "above is the record of which routes do that and why (#1828). " +
        "Something has moved. If you added or removed a forcing on purpose, " +
        "add or remove its line above and say what makes that screen need it. " +
        "If you did not, a screen whose artwork is dark has gone back to " +
        "following the player's theme, which on the light one is unreadable " +
        "text over a picture (#1809).",
    ).toEqual([...FORCED].sort());
  });
});
