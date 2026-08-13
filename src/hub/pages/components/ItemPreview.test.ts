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

describe("ItemPreview, for a blueprint", () => {
  it("draws one square per building, sized by its footprint", () => {
    const html = markup(BLUEPRINT);
    const [solar, lab] = rects(html);
    expect(rects(html)).toHaveLength(2);
    expect(lab.width).toBeGreaterThan(solar.width);
    expect(lab.height).toBeGreaterThan(solar.height);
    // Rounded, and drawn in the card's own colours rather than fixed greys.
    expect(html).toContain('rx="0.18"');
    expect(html).toContain("fill-card stroke-border");
  });

  it("fits every square inside the viewBox it sets", () => {
    const html = markup(BLUEPRINT);
    const box = html.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (!box) throw new Error("no viewBox");
    const [width, height] = [Number(box[1]), Number(box[2])];
    for (const rect of rects(html)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    }
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
