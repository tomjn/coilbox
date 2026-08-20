import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORCED_DARK_CLASS } from "./forcedDark";

/**
 * The class that makes the conquest galaxy and the warpath map dark (#1809).
 *
 * `forcedDark.dom.test.tsx` proves the forcing does not escape those two routes.
 * This proves it reaches them at all, which is not obvious: `.dark` on a subtree
 * redefines `--card`, but `.bg-card` reads `--color-card`, and Tailwind's `@theme`
 * resolves that at `:root`, against whichever ramp is live there, and hands the
 * answer down already resolved. So `.forced-dark` in `src/index.css` has to
 * re-declare the whole mapping, and a name it misses is a utility that quietly
 * stays light on the map.
 *
 * The list is read back out of the stylesheet and measured against picoframe's own
 * `@theme` block rather than written here, so a token picoframe adds later fails
 * this instead of going unnoticed.
 */

const APP_CSS = readFileSync(
  fileURLToPath(new URL("../index.css", import.meta.url)),
  "utf8",
);
const FRAME_CSS = readFileSync(
  fileURLToPath(
    new URL(
      "../../node_modules/@picoframe/frame/src/theme.css",
      import.meta.url,
    ),
  ),
  "utf8",
);

/** The body of a `selector { ... }` block, up to its closing brace on its own line. */
function block(css: string, selector: string): string {
  const found = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (!found) throw new Error(`no ${selector} block`);
  return found[1];
}

/** The `--color-*` names a block declares. */
function colourNames(body: string): string[] {
  return [...body.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]);
}

const FORCED = block(APP_CSS, "\\.forced-dark");

describe("the .forced-dark colour mapping", () => {
  it("re-declares every colour picoframe's @theme resolves at :root", () => {
    expect(colourNames(FORCED).sort()).toEqual(
      colourNames(block(FRAME_CSS, "@theme")).sort(),
    );
  });

  it("points each colour at the raw token of the same name", () => {
    // A typo here pins one utility to the wrong token in both ramps at once,
    // which is harder to spot than it staying light.
    const pairs = [
      ...FORCED.matchAll(
        /--color-([a-z0-9-]+):\s*hsl\(var\(--([a-z0-9-]+)\)\);/g,
      ),
    ];
    expect(pairs).toHaveLength(colourNames(FORCED).length);
    for (const [, name, token] of pairs) {
      expect(token, `--color-${name}`).toBe(name);
    }
  });

  it("hands native controls and scrollbars the dark scheme too", () => {
    expect(FORCED).toMatch(/color-scheme:\s*dark;/);
  });
});

describe("where the forcing is allowed to live", () => {
  it("stays a class the pages put on their own element", () => {
    // A later fix that reached for `documentElement.classList` would pass every
    // visual check and reopen #1118, where a branded run left its colour on
    // somebody's ordinary install.
    expect(FORCED_DARK_CLASS.split(" ")).toEqual(["dark", "forced-dark"]);
    expect(APP_CSS).not.toMatch(/(?:^|[\s,])(?:html|:root)[^{,]*\.forced-dark/);
  });
});
