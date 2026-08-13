/**
 * The blueprint drawing, rendered.
 *
 * `../../preview.test.ts` covers the arithmetic. What this covers is that the
 * arithmetic reaches the picture: the app has no way to look at a hub item
 * without the hub, an account and somebody's published layout, so rendering the
 * component to markup and reading the geometry back out is the evidence that a
 * blueprint draws anything at all.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Container } from "@/container/container";
import { readPreview } from "../../preview";
import { ItemPreview } from "./ItemPreview";

/** A two building layout: a solar collector on one square, and a lab on six. */
const BLUEPRINT: Container = {
  format: "coilbox",
  container: 1,
  kind: "blueprint",
  kindVersion: 1,
  payload: {
    name: "A lab and a solar",
    buildings: [
      { def: "armsolar", offset: { x: -64, z: 0 }, facing: 0 },
      { def: "armlab", offset: { x: 32, z: 0 }, facing: 0 },
    ],
    footprints: { armsolar: { x: 1, z: 1 }, armlab: { x: 3, z: 2 } },
  },
};

function markup(container: Container): string {
  const preview = readPreview(container);
  if (!preview) throw new Error("nothing to draw");
  return renderToStaticMarkup(createElement(ItemPreview, { preview }));
}

/** Every rect's attributes, in the order they were drawn. */
function rects(html: string): Record<string, number>[] {
  return [...html.matchAll(/<rect [^>]*>/g)].map((match) => {
    const attrs: Record<string, number> = {};
    // The name has to start at a space, or `stroke-width` reads as `width`.
    for (const [, name, value] of match[0].matchAll(
      /\s([\w-]+)="([-\d.]+)"/g,
    )) {
      attrs[name] = Number(value);
    }
    return attrs;
  });
}

/** The sheet the drawing sets, which starts at the top left of the clear ground
 *  rather than at the top left of the base. */
function viewBox(html: string): number[] {
  const box = html.match(/viewBox="([-\d. ]+)"/);
  if (!box) throw new Error("no viewBox");
  return box[1].split(" ").map(Number);
}

describe("ItemPreview, for a blueprint", () => {
  it("draws one square per building, sized by its footprint", () => {
    const html = markup(BLUEPRINT);
    const [solar, lab] = rects(html);
    expect(rects(html)).toHaveLength(2);
    expect(lab.width).toBeGreaterThan(solar.width);
    expect(lab.height).toBeGreaterThan(solar.height);
    // Rounded, and taking the theme colour rather than fixed greys.
    expect(html).toContain('rx="0.1"');
    expect(html).toContain("text-primary");
  });

  it("draws the base on a grid, with clear ground round it", () => {
    const html = markup(BLUEPRINT);
    const [left, top, width, height] = viewBox(html);
    // A square of clear ground on every side, which is what makes it a sheet.
    expect([left, top]).toEqual([-1, -1]);
    for (const rect of rects(html)) {
      expect(rect.x).toBeGreaterThanOrEqual(left + 1);
      expect(rect.y).toBeGreaterThanOrEqual(top + 1);
      expect(rect.x + rect.width).toBeLessThanOrEqual(left + width - 1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(top + height - 1);
    }
    // Rules on the build squares, not on the edge of the sheet.
    const verticals = [...html.matchAll(/<line x1="([-\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(verticals.length).toBeGreaterThan(1);
    for (const x of verticals) expect(Number.isInteger(x)).toBe(true);
  });

  it("threads the build order from its start, and only when there is one", () => {
    // Two buildings a lab apart, so a thread has somewhere to run.
    expect(markup(BLUEPRINT)).not.toContain("<path");
    expect(markup(BLUEPRINT)).not.toContain("<circle");

    const ordered = {
      ...BLUEPRINT,
      payload: { ...(BLUEPRINT.payload as object), ordered: true },
    };
    const html = markup(ordered);
    expect(html).toContain("<path");
    expect(html).toContain("<circle");
  });

  it("leaves a building the payload never sized as an outline", () => {
    const html = markup({
      ...BLUEPRINT,
      payload: {
        name: "Half measured",
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "whatisthis", offset: { x: 32, z: 0 }, facing: 0 },
        ],
        footprints: { armsolar: { x: 1, z: 1 } },
      },
    });
    const [solar, unknown] = rects(html);
    expect(solar["fill-opacity"]).toBeGreaterThan(0);
    expect(unknown["fill-opacity"]).toBe(0);
  });

  it("says how many buildings there are, and whether they are in order", () => {
    expect(markup(BLUEPRINT)).toContain("2 buildings");
    expect(markup(BLUEPRINT)).not.toContain("in build order");

    const ordered = {
      ...BLUEPRINT,
      payload: { ...(BLUEPRINT.payload as object), ordered: true },
    };
    expect(markup(ordered)).toContain("2 buildings, in build order");
  });
});
