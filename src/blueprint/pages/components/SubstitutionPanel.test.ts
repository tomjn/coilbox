/**
 * The conversion panel, rendered.
 *
 * `../../substitution.test.ts` covers what a substitution does to a layout. What
 * this covers is that the person doing it is told: that a swap which moves the
 * layout says so before it is applied, in a warning that reads as one, and that a
 * game offering no mapping still gets a row per building to pick for.
 *
 * The queued units are the same promise over the mission's half of a placement
 * (issue #1493), and the half most likely to come back with nothing suggested,
 * so the row and the warning matter more there than anywhere.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type EquivalenceTable,
  learnEquivalence,
  mergeEquivalents,
  NO_EQUIVALENTS,
} from "../../equivalents";
import type { BaseBlueprint } from "../../model";
import { gameSides, sideUnitPrefixes } from "../../substitution";
import { SubstitutionPanel } from "./SubstitutionPanel";

const SIDES = sideUnitPrefixes([
  { name: "Armada", startUnit: "armcom" },
  { name: "Cortex", startUnit: "corcom" },
]);

/** A game whose sides are named and whose units say nothing about which side
 *  they are, which is what issue #1527 is about. */
const OPAQUE = gameSides([
  { name: "Empire", startUnit: "empire_commander" },
  { name: "Rebels", startUnit: "rebel_hq" },
]);

const UNITS = [
  { name: "armsolar", footprintX: 2, footprintZ: 2 },
  { name: "corsolar", footprintX: 3, footprintZ: 3 },
  { name: "armmex", footprintX: 2, footprintZ: 2 },
  { name: "cormex", footprintX: 2, footprintZ: 2 },
  { name: "armllt", footprintX: 2, footprintZ: 2 },
  // Two mobile units, one pair the naming route reaches and one it does not:
  // Cortex's answer to `armpw` is `corak`.
  { name: "armck", footprintX: 2, footprintZ: 2, mobile: true },
  { name: "corck", footprintX: 2, footprintZ: 2, mobile: true },
  { name: "armpw", footprintX: 2, footprintZ: 2, mobile: true },
  { name: "corak", footprintX: 2, footprintZ: 2, mobile: true },
];

/** Two solars touching, whose Cortex equivalent is a square wider. */
const layout: BaseBlueprint = {
  id: "l1",
  name: "Opening solars",
  buildings: [
    { def: "armsolar", offset: { x: -16, z: 0 }, facing: 0 },
    { def: "armsolar", offset: { x: 16, z: 0 }, facing: 0 },
  ],
};

function markup(
  over: Partial<Parameters<typeof SubstitutionPanel>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(SubstitutionPanel, {
      layout,
      sides: SIDES,
      units: UNITS,
      onApply: () => {},
      ...over,
    }),
  );
}

describe("SubstitutionPanel", () => {
  it("opens on the side the layout is not already written in", () => {
    expect(markup()).toContain("to Cortex");
  });

  it("proposes the other side's building where the game has one", () => {
    expect(markup()).toContain("corsolar");
  });

  it("says a substitute that will move the layout will move it, before it is applied", () => {
    const html = markup();
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain("will not stand where they do now");
    expect(html).toContain("ground another building wants");
  });

  it("says on the row itself that the substitute stands on more ground", () => {
    expect(markup()).toContain('data-tone="resized"');
    expect(markup()).toContain("3 by 3 build squares rather than 2 by 2");
  });

  it("offers a row to pick for even when the game suggests nothing", () => {
    const html = markup({ sides: [] });
    expect(html).toContain("says nothing about which of its buildings");
    expect(html).toContain("armsolar");
    expect(html).toContain("Nothing to convert");
  });

  it("suggests nothing for a building the other side has not got", () => {
    const html = markup({
      layout: {
        ...layout,
        buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 }],
      },
    });
    expect(html).not.toContain("corllt");
    expect(html).toContain("Nothing to convert");
  });

  it("checks nothing, and says so, before the game's units have been read", () => {
    expect(markup({ units: [] })).toContain("has not read this game");
  });

  it("offers to put a converted layout back", () => {
    const html = markup({
      layout: {
        ...layout,
        buildings: [
          {
            def: "corsolar",
            offset: { x: -8, z: 8 },
            facing: 0,
            originalName: "armsolar",
          },
        ],
      },
    });
    expect(html).toContain("Put it back");
  });

  it("says nothing about putting back a layout nobody has converted", () => {
    expect(markup()).not.toContain("Put it back");
  });

  /** Issue #1493. A layout on its own has no queues, so none of this shows up in
   *  the library.
   *
   *  The picked substitutes are not in this markup: the picker keeps its list in
   *  a portal and shows the choice through it, so what says a plan reached a
   *  queued unit is the button that counts it. */
  describe("the units queued on a base's factories", () => {
    /** One turret nothing can be swapped for, so anything the button counts
     *  came from the queue rather than from the buildings. */
    const llt: BaseBlueprint = {
      ...layout,
      buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 }],
    };

    it("says nothing about queues when there are none", () => {
      expect(markup()).not.toContain("Queued on this base");
    });

    it("converts a queued unit the game's naming reaches, buildings or no", () => {
      const html = markup({ layout: llt, queued: ["armck"] });
      expect(html).toContain("Queued on this base");
      expect(html).toContain("Convert 1 queued unit to Cortex");
    });

    it("counts the orders rather than the units on the row", () => {
      expect(markup({ layout: llt, queued: ["armck", "armck"] })).toContain(
        "queued twice",
      );
    });

    it("counts the queued units on the button that converts them", () => {
      expect(markup({ layout: llt, queued: ["armck", "armck"] })).toContain(
        "2 queued units",
      );
    });

    it("warns that a queued unit it found nothing for builds nothing", () => {
      const html = markup({ layout: llt, queued: ["armpw"] });
      expect(html).not.toContain("corpw");
      expect(html).toContain("cannot build another side&#x27;s units");
      expect(html).toContain("armpw");
      expect(html).toContain("Nothing to convert");
    });

    /** A queue is a list of names with nothing under it, so the row says no
     *  ground and never accuses a substitute of moving anything. */
    it("says nothing about ground on a queued unit's row", () => {
      const html = markup({ layout: llt, queued: ["armck"] });
      expect(html).not.toContain('data-tone="resized"');
      expect(html).not.toContain("build squares");
    });

    /** A queue does not remember what it was, so the offer to put the buildings
     *  back has to say what it does not cover. */
    it("says putting the buildings back leaves the queues alone", () => {
      const html = markup({
        layout: {
          ...layout,
          buildings: [
            {
              def: "corsolar",
              offset: { x: -8, z: 8 },
              facing: 0,
              originalName: "armsolar",
            },
          ],
        },
        queued: ["armck"],
      });
      expect(html).toContain("leaves the queues as they are");
    });
  });

  /**
   * Issue #1468. What a person said last time about this game, used before any
   * name is read, which is the only route that ever reaches a queued unit.
   */
  describe("what this game has already been told", () => {
    const knows = learnEquivalence(
      NO_EQUIVALENTS,
      "Armada",
      "armpw",
      "Cortex",
      "corak",
    );
    const llt: BaseBlueprint = {
      ...layout,
      buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 }],
    };

    it("converts a queued unit no naming reaches, once somebody has said what it is", () => {
      const html = markup({ layout: llt, queued: ["armpw"], table: knows });
      expect(html).toContain("Convert 1 queued unit to Cortex");
      expect(html).not.toContain("cannot build another side&#x27;s units");
    });

    it("says how much of this game it has been told, so the suggestions are accounted for", () => {
      expect(markup({ table: knows })).toContain("2 of this game");
    });

    it("says nothing about a table nobody has filled in", () => {
      expect(markup()).not.toContain("of this game&#x27;s units and uses");
    });

    it("keeps units plural for a table holding one answer", () => {
      const one: EquivalenceTable = {
        groups: [{ Armada: { def: "armsolar", from: "you" } }],
      };
      expect(markup({ table: one })).toContain(
        "answers for 1 of this game&#x27;s units and uses those first",
      );
    });

    /**
     * Issue #1544. Whose answers they are. A game's published table lands 87 of
     * them at once, so counting the lot as what this person converted tells
     * them they picked answers nobody here gave, which reads worst for somebody
     * who suspects one is wrong.
     */
    describe("whose answers it is counting", () => {
      const shipped: EquivalenceTable = {
        groups: [
          {
            Armada: { def: "armsolar", from: "game" },
            Cortex: { def: "corsolar", from: "game" },
          },
        ],
      };

      it("counts the answers a person gave apart from the game's", () => {
        const html = markup({ table: mergeEquivalents(knows, shipped) });
        expect(html).toContain("4 of this game&#x27;s units");
        expect(html).toContain("2 you picked while converting");
        expect(html).toContain(
          "2 brought by this game&#x27;s own published table",
        );
      });

      it("claims none of a table that only came from the game's own file", () => {
        const html = markup({ table: shipped });
        expect(html).toContain(
          "brought by this game&#x27;s own published table",
        );
        expect(html).not.toContain("you picked");
      });

      it("claims an answer it cannot account for for nobody", () => {
        const html = markup({
          table: {
            groups: [{ Armada: { def: "armpw" }, Cortex: { def: "corak" } }],
          },
        });
        expect(html).toContain("before coilbox recorded where an answer came");
        expect(html).not.toContain("you picked");
      });
    });

    /**
     * Issue #1527. A game whose unit names say nothing about its sides still
     * has sides, and a swap it cannot file under one teaches the table nothing
     * unless somebody says which side the building was.
     *
     * The table here holds two groups that disagree about whose `armsolar` is,
     * which is the one way a def can be swapped and have no side in a rendered
     * panel: everything else needs somebody to pick a substitute first, and a
     * rendered panel is not clicked.
     */
    it("asks which side a swapped building is when nothing else can say", () => {
      const html = markup({
        sides: OPAQUE,
        table: {
          groups: [
            { Rebels: { def: "armsolar" }, Empire: { def: "armmex" } },
            { Legion: { def: "armsolar" }, Rebels: { def: "legsolar" } },
          ],
        },
      });
      expect(html).toContain("cannot tell which side");
      expect(html).toContain("Say which side it is");
    });

    it("asks nothing about a game whose own names say which side is which", () => {
      const html = markup();
      expect(html).not.toContain("Say which side it is");
      expect(html).not.toContain("cannot tell which side");
    });

    /** Issue #1526. One game publishes its own table, so the offer to read it
     *  is there when there is something to read it with and nowhere else. */
    describe("reading the game's own table", () => {
      it("offers to read it", () => {
        expect(markup({ onReadShipped: () => {} })).toContain(
          "Read this game&#x27;s own pairings",
        );
      });

      it("offers nothing for a game coilbox cannot go and read", () => {
        expect(markup()).not.toContain("own pairings");
      });

      it("says what reading it did", () => {
        expect(
          markup({
            onReadShipped: () => {},
            shippedNote: "Read 86 pairings, 23 of them new.",
          }),
        ).toContain("23 of them new");
      });
    });

    it("offers the sides only the table knows about", () => {
      // No prefixes at all, so without the table this game has no side picker
      // and every row has to be filled in by hand, every time.
      const opaque = learnEquivalence(
        NO_EQUIVALENTS,
        "Empire",
        "armsolar",
        "Rebels",
        "armmex",
      );
      const html = markup({ sides: [], table: opaque });
      expect(html).toContain("Say this blueprint in");
      expect(html).not.toContain("says nothing about which of its buildings");
    });
  });
});
