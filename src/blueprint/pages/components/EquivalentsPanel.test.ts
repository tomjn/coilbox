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
    {
      Armada: { def: "armsolar", from: "you" },
      Cortex: { def: "corsolar", from: "you" },
      Legion: { def: "legsolar", from: "game" },
    },
    { Armada: { def: "armpw", from: "you" }, Cortex: { def: "corak" } },
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

/** The words of one pairing's row, which is what a person actually reads off
 *  it. Tags out, so nothing here is a claim about how it is marked up. */
function rowText(html: string, at: number): string {
  const rows = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)];
  return (rows[at]?.[1] ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
        {
          Armada: { def: "armsolar", from: "you" },
          Cortex: { def: "corsolar", from: "you" },
          Legion: { def: "legsolar", from: "you" },
        },
        { Armada: { def: "armpw" }, Legion: { def: "legpw" } },
      ],
    });
    expect(labels(html)[1]).toBe("Forget armpw and legpw");
  });

  it("says nothing at all about a game nobody has answered anything about", () => {
    expect(markup({ groups: [] })).toBe("");
  });

  /** Issue #1537. Whose answer each one is, because the ones a person gave are
   *  the ones they can be sure they meant, and the rest are not. */
  describe("where each answer came from", () => {
    it("says which answers a person gave and which the game's file brought", () => {
      expect(rowText(markup(TABLE), 0)).toBe(
        "Armada armsolar you Cortex corsolar you Legion legsolar the game",
      );
    });

    it("claims nothing about an answer stored before it started recording this", () => {
      expect(rowText(markup(TABLE), 1)).toBe("Armada armpw you Cortex corak");
    });

    it("says an unmarked answer is one from before, rather than one from nowhere", () => {
      expect(markup(TABLE)).toContain("before it started recording");
    });

    it("says nothing of the sort when it can account for every answer", () => {
      const html = markup({
        groups: [
          {
            Armada: { def: "armpw", from: "you" },
            Cortex: { def: "corak", from: "you" },
          },
        ],
      });
      expect(html).not.toContain("before it started recording");
    });
  });
});
