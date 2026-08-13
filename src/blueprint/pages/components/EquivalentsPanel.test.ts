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

function markup(table: EquivalenceTable, query = ""): string {
  return renderToStaticMarkup(
    createElement(EquivalentsPanel, {
      table,
      query,
      onQuery: nothing,
      onForget: nothing,
      onForgetAll: nothing,
    }),
  );
}

/** Every control's accessible name, which for a row is what says it can be
 *  dropped. */
function labels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
}

/** Only the rows, for a table whose controls are not all rows. */
function rows(html: string): string[] {
  return labels(html).filter((label) => label.startsWith("Forget "));
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

    /**
     * Issue #1545. Reading Beyond All Reason's published table lands 87 rows in
     * one go, and the few answers a person gave are then somewhere in the
     * middle of them. Their own come first so the list is worth opening.
     */
    describe("finding your own answers in a long table", () => {
      const long: EquivalenceTable = {
        groups: [
          {
            Armada: { def: "armanni", from: "game" },
            Cortex: { def: "cordoom", from: "game" },
          },
          {
            Armada: { def: "armpw", from: "you" },
            Cortex: { def: "corak", from: "you" },
          },
          {
            Armada: { def: "armsolar", from: "game" },
            Cortex: { def: "corsolar", from: "you" },
          },
        ],
      };

      it("lists the answers a person gave before the ones they did not", () => {
        expect(labels(markup(long))).toEqual([
          "Forget armpw and corak",
          "Forget armsolar and corsolar",
          "Forget armanni and cordoom",
        ]);
      });

      it("says how many of them are theirs, so they know where their own stop", () => {
        expect(markup(long)).toContain("The 2 holding an answer you gave");
      });

      it("says one holding an answer is first, not are", () => {
        const one: EquivalenceTable = {
          groups: [
            {
              Armada: { def: "armpw", from: "you" },
              Cortex: { def: "corak", from: "you" },
            },
            {
              Armada: { def: "armsolar", from: "game" },
              Cortex: { def: "corsolar", from: "game" },
            },
          ],
        };
        expect(markup(one)).toContain(
          "The 1 holding an answer you gave is first",
        );
      });

      it("says nothing about an order in a table that is all one kind", () => {
        expect(markup({ groups: [long.groups[0]] })).not.toContain(
          "holding an answer you gave",
        );
      });
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

  /**
   * Issue #1547. The other question somebody arrives with is about one
   * building: what does coilbox think corak is, usually because a base built
   * the wrong thing. Reading Beyond All Reason's published table lands 87 rows
   * to read for that one name.
   */
  describe("finding one building", () => {
    const filler = Array.from({ length: 11 }, (_, n) => ({
      Armada: { def: `armfill${n}`, from: "game" as const },
      Cortex: { def: `corfill${n}`, from: "game" as const },
    }));
    const long: EquivalenceTable = {
      groups: [
        {
          Armada: { def: "armsolar", from: "game" },
          Cortex: { def: "corsolar", from: "game" },
        },
        {
          Armada: { def: "armadvsolar", from: "you" },
          Cortex: { def: "coradvsolar", from: "you" },
        },
        ...filler,
      ],
    };

    it("offers a box for a table too long to find one name in by eye", () => {
      expect(labels(markup(long))).toContain("Find a building");
    });

    it("offers none for a table short enough to read at a glance", () => {
      expect(labels(markup(TABLE))).not.toContain("Find a building");
    });

    it("shows only the rows naming what was typed", () => {
      expect(rows(markup(long, "advsolar"))).toEqual([
        "Forget armadvsolar and coradvsolar",
      ]);
    });

    it("keeps the answers you gave first inside a search", () => {
      expect(rows(markup(long, "solar"))).toEqual([
        "Forget armadvsolar and coradvsolar",
        "Forget armsolar and corsolar",
      ]);
    });

    it("holds what was typed, so no row is hidden without saying why", () => {
      expect(markup(long, "solar")).toContain('value="solar"');
    });

    it("counts how many rows the search is holding back", () => {
      expect(markup(long, "solar")).toContain("Showing 2 of 13");
    });

    it("counts nothing while the box is empty, because nothing is hidden", () => {
      expect(markup(long)).not.toContain("Showing");
    });

    it("says a search found nothing rather than showing an empty list", () => {
      const html = markup(long, "legpw");
      expect(rows(html)).toEqual([]);
      expect(html).toContain("Nothing in this table names legpw");
    });

    it("still offers to drop the whole table rather than the search", () => {
      expect(markup(long, "advsolar")).toContain("Forget all 13");
    });

    it("ignores a search left over from before the box went away", () => {
      // Dropping rows can take a table back under the length worth searching,
      // and a search still narrowing with no box to clear it would hide rows
      // with nothing on the page to say so.
      expect(rows(markup(TABLE, "legpw"))).toHaveLength(2);
    });
  });
});
