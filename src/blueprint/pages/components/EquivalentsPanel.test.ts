/**
 * The game's equivalence table, rendered (issue #1533).
 *
 * The point of the surface is that an answer nobody can look at is the one that
 * silently changes what a base builds, so what is worth covering is that every
 * pairing reaches the screen and that each one can be named to drop it. The
 * arithmetic underneath is `../../equivalents.test.ts` and
 * `../../equivalentsStore.test.ts`.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EquivalenceTable } from "../../equivalents";
import { EquivalentsPanel } from "./EquivalentsPanel";

const TABLE: EquivalenceTable = {
  groups: [
    { Armada: "armsolar", Cortex: "corsolar", Legion: "legsolar" },
    { Armada: "armpw", Cortex: "corak" },
  ],
};

const nothing = () => {};

function markup(table: EquivalenceTable): string {
  return renderToStaticMarkup(
    createElement(EquivalentsPanel, {
      table,
      onForget: nothing,
      onForgetAll: nothing,
    }),
  );
}

/** Every button's accessible name, which is what says a row can be dropped. */
function labels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
}

describe("EquivalentsPanel", () => {
  it("shows every def of every pairing, under the side that calls it that", () => {
    const html = markup(TABLE);
    for (const def of ["armsolar", "corsolar", "legsolar", "armpw", "corak"]) {
      expect(html).toContain(def);
    }
    for (const side of ["Armada", "Cortex", "Legion"]) {
      expect(html).toContain(side);
    }
  });

  it("names each pairing on the control that drops it", () => {
    expect(labels(markup(TABLE))).toEqual([
      "Forget armsolar and corsolar and legsolar",
      "Forget armpw and corak",
    ]);
  });

  it("says how many dropping the lot would drop", () => {
    expect(markup(TABLE)).toContain("Forget all 2");
  });

  it("leaves a gap for a side a pairing says nothing about", () => {
    const html = markup({
      groups: [
        { Armada: "armsolar", Cortex: "corsolar", Legion: "legsolar" },
        { Armada: "armpw", Legion: "legpw" },
      ],
    });
    expect(labels(html)[1]).toBe("Forget armpw and legpw");
  });

  it("says nothing at all about a game nobody has answered anything about", () => {
    expect(markup({ groups: [] })).toBe("");
  });
});
