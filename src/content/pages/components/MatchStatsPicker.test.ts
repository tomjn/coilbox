import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Metric, MetricKey } from "../../bindings";
import type { MetricTileGroup } from "../../matchStats";
import { MatchStatsPicker } from "./MatchStatsPicker";

/**
 * Where the picker's cap, its scroll and its labels apply.
 *
 * vitest runs in node with no layout, so nothing here measures anything. What
 * it holds is which classes carry a breakpoint, which is the whole of the bug
 * in #1216: the cap and the scroll were written unprefixed, so the wide grid
 * under the plot inherited the two things only the narrow column beside it
 * needs. The widths themselves were read off the running app.
 */

/**
 * The picker passes a key straight back to its caller and never reads it, and
 * naming a real metric here would break the registry's rule about who may.
 */
const key = (n: number) => `metric${n}` as MetricKey;

function metric(n: number, label: string): Metric {
  return {
    key: key(n),
    label,
    group: "economy",
    unit: "count",
    roster: false,
    headline: false,
    surfaced: true,
  };
}

/** The two labels that were cut off at six across, and one that was not. */
const groups: MetricTileGroup[] = [
  {
    group: "economy",
    label: "Economy",
    tiles: [
      { metric: metric(0, "Energy produced"), lines: [] },
      { metric: metric(1, "Damage received"), lines: [] },
      { metric: metric(2, "Metal used"), lines: [] },
    ],
  },
];

function markup(): string {
  return renderToStaticMarkup(
    createElement(MatchStatsPicker, {
      groups,
      value: key(0),
      plotHeight: 420,
      onChange: () => {},
    }),
  );
}

/** The classes on the element carrying the picker's own name. */
function groupClasses(): string {
  const tag = /<div[^>]*aria-label="Charted metric[^"]*"[^>]*>/.exec(markup());
  expect(tag, "the picker is not named any more").toBeTruthy();
  return /class="([^"]*)"/.exec(tag?.[0] ?? "")?.[1] ?? "";
}

/** Every tile's classes, and every label's. */
function tileClasses(): { tile: string; label: string }[] {
  return [
    ...markup().matchAll(/<button[^>]*class="([^"]*)"[^>]*>(.*?)<\/button>/g),
  ].map((m) => ({
    tile: m[1],
    label: /<span[^>]*class="([^"]*)"/.exec(m[2])?.[1] ?? "",
  }));
}

describe("the metric picker's layout", () => {
  it("caps its height only where it is a column beside the plot", () => {
    const cls = groupClasses();
    expect(cls).toMatch(/lg:max-h-/);
    // Unprefixed, this is the 224px box the stacked grid was trapped in.
    expect(cls).not.toMatch(/(^| )max-h-/);
  });

  it("scrolls only where it is a column beside the plot", () => {
    const cls = groupClasses();
    expect(cls).toMatch(/lg:overflow-y-auto/);
    // A scrolling box inside a scrolling page hides the group headings.
    expect(cls).not.toMatch(/(^| )overflow-(y-)?auto/);
  });

  it("wraps a label instead of cutting it", () => {
    const tiles = tileClasses();
    expect(tiles.length, "the tiles are not buttons any more").toBe(3);
    for (const { label } of tiles) {
      expect(label).not.toMatch(/(^| )truncate( |$)/);
      // The toggle item sets `whitespace-nowrap`, which the label inherits, so
      // dropping `truncate` on its own spills the text out of the tile.
      expect(label).toMatch(/(^| )whitespace-normal( |$)/);
    }
  });

  it("keeps a row's sparklines level when a neighbour's label wraps", () => {
    // Tiles stretch to the tallest in their grid row, so without this the shape
    // in each one sits wherever its own label left it.
    for (const { tile } of tileClasses())
      expect(tile).toMatch(/(^| )justify-between( |$)/);
  });
});
