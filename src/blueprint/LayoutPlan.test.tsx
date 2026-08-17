/**
 * A plan drawn as its buildings (issue #1721).
 *
 * The placement arithmetic is `pictureBox` in `@/hub/preview` and is tested there.
 * What this covers is that the drawing uses it: a building the hub has a picture of
 * is drawn as that unit at the right size, and one it has nothing for still gets
 * its square.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanPicture } from "@/hub/assets/unitPictures";
import { RENDER_BLEED_SQUARES } from "@/hub/assets/vocabulary";
import { BUILDING_GAP, blueprintShape } from "@/hub/preview";
import { LayoutPlan } from "./LayoutPlan";
import type { BlueprintPayload } from "./payload";

/** A solar collector on one square and a lab on six, four squares apart. */
const LAYOUT: BlueprintPayload = {
  name: "A lab and a solar",
  buildings: [
    { def: "armsolar", offset: { x: -64, z: 0 }, facing: 0 },
    { def: "armlab", offset: { x: 32, z: 0 }, facing: 0 },
  ],
  footprints: { armsolar: { x: 1, z: 1 }, armlab: { x: 3, z: 2 } },
};

function markup(pictures?: ReadonlyMap<string, PlanPicture>): string {
  const shape = blueprintShape(LAYOUT);
  if (!shape) throw new Error("nothing to draw");
  return renderToStaticMarkup(<LayoutPlan shape={shape} pictures={pictures} />);
}

/** Every element of one tag, with its numeric attributes read back. */
function drawn(html: string, tag: string): Record<string, number>[] {
  return [...html.matchAll(new RegExp(`<${tag} [^>]*>`, "g"))].map((match) => {
    const attrs: Record<string, number> = {};
    for (const [, name, value] of match[0].matchAll(
      /\s([\w-]+)="([-\d.]+)"/g,
    )) {
      attrs[name] = Number(value);
    }
    return attrs;
  });
}

const render = (url: string): PlanPicture => ({ url, framed: true });

describe("LayoutPlan", () => {
  it("draws nothing but squares when it has no pictures", () => {
    const html = markup();
    expect(html).not.toContain("<image");
    expect(drawn(html, "rect")).toHaveLength(2);
  });

  it("draws a building it has a picture of as that unit", () => {
    const html = markup(new Map([["armlab", render("https://cdn/lab.webp")]]));
    expect(html).toContain('href="https://cdn/lab.webp"');
    const [picture] = drawn(html, "image");
    const lab = drawn(html, "rect").find((rect) => rect.width > 1);
    if (!lab) throw new Error("expected the lab's square");

    // The ground the building stands on, its drawing gap added back, and the
    // render's bleed round that, so the model lands at true scale.
    const grow = BUILDING_GAP + RENDER_BLEED_SQUARES;
    expect(picture.x).toBeCloseTo(lab.x - grow);
    expect(picture.y).toBeCloseTo(lab.y - grow);
    expect(picture.width).toBeCloseTo(lab.width + grow * 2);
    expect(picture.height).toBeCloseTo(lab.height + grow * 2);
    // The picture's box keeps the footprint's aspect, which is what makes it
    // tile into the plan rather than sit in it as an icon.
    expect(picture.width / picture.height).toBeCloseTo(
      (3 + RENDER_BLEED_SQUARES * 2) / (2 + RENDER_BLEED_SQUARES * 2),
    );
  });

  it("takes the tint off a building showing its own picture, and only that one", () => {
    const html = markup(new Map([["armlab", render("https://cdn/lab.webp")]]));
    const [solar, lab] = drawn(html, "rect");
    expect(lab["fill-opacity"]).toBe(0);
    expect(solar["fill-opacity"]).toBeGreaterThan(0);
  });

  it("draws a build pic standing in for a render inside the building's ground", () => {
    const html = markup(
      new Map([["armlab", { url: "https://cdn/lab.webp", framed: false }]]),
    );
    const [picture] = drawn(html, "image");
    const lab = drawn(html, "rect").find((rect) => rect.width > 1);
    if (!lab) throw new Error("expected the lab's square");
    // No bleed to add back, so it fits the square and is centred in it by
    // `preserveAspectRatio` rather than being stretched to the footprint.
    expect(picture.width).toBeCloseTo(lab.width);
    expect(picture.height).toBeCloseTo(lab.height);
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("matches a def however the author's game spelled it", () => {
    const html = markup(new Map([["armlab", render("https://cdn/lab.webp")]]));
    expect(drawn(html, "image")).toHaveLength(1);

    const shouted: BlueprintPayload = {
      ...LAYOUT,
      buildings: [{ def: "ARMLAB", offset: { x: 32, z: 0 }, facing: 0 }],
      footprints: { ARMLAB: { x: 3, z: 2 } },
    };
    const shape = blueprintShape(shouted);
    if (!shape) throw new Error("nothing to draw");
    const same = renderToStaticMarkup(
      <LayoutPlan
        shape={shape}
        pictures={new Map([["armlab", render("https://cdn/lab.webp")]])}
      />,
    );
    expect(drawn(same, "image")).toHaveLength(1);
  });
});
