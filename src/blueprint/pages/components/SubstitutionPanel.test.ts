/**
 * The conversion panel, rendered.
 *
 * `../../substitution.test.ts` covers what a substitution does to a layout. What
 * this covers is that the person doing it is told: that a swap which moves the
 * layout says so before it is applied, in a warning that reads as one, and that a
 * game offering no mapping still gets a row per building to pick for.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BaseBlueprint } from "../../model";
import { sideUnitPrefixes } from "../../substitution";
import { SubstitutionPanel } from "./SubstitutionPanel";

const SIDES = sideUnitPrefixes([
  { name: "Armada", startUnit: "armcom" },
  { name: "Cortex", startUnit: "corcom" },
]);

const UNITS = [
  { name: "armsolar", footprintX: 2, footprintZ: 2 },
  { name: "corsolar", footprintX: 3, footprintZ: 3 },
  { name: "armmex", footprintX: 2, footprintZ: 2 },
  { name: "cormex", footprintX: 2, footprintZ: 2 },
  { name: "armllt", footprintX: 2, footprintZ: 2 },
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
});
