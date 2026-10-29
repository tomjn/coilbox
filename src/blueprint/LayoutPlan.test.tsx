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
import { RENDER_BLEED_SQUARES, renderFrame } from "@/hub/assets/vocabulary";
import { BUILDING_GAP, blueprintShape } from "@/hub/preview";
import { LayoutPlan } from "./LayoutPlan";
import type { BlueprintPayload } from "./payload";
import { BUILDING_CSS, buildingRoles } from "./role";

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

/** The lab's own footprint, which is what a render of it is framed against. */
const LAB_FOOTPRINT = [3, 2] as const;

/** A render of the lab, drawn with `bleed` squares round its footprint. The
 *  pixel size is the whole of what says so, since nothing else travels with a
 *  picture. */
const render = (
  url: string,
  bleed: number = RENDER_BLEED_SQUARES,
): PlanPicture => {
  const frame = renderFrame(...LAB_FOOTPRINT, bleed);
  return {
    url,
    framed: true,
    widthPx: frame.widthPx,
    heightPx: frame.heightPx,
  };
};

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
      new Map([
        [
          "armlab",
          {
            url: "https://cdn/lab.webp",
            framed: false,
            widthPx: 256,
            heightPx: 256,
          },
        ],
      ]),
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

  it("draws a render that was framed wider in the wider box it needs", () => {
    // A model reaching past one square is framed with more, and the plan has to
    // draw the wider picture over more ground or the unit lands small (#2952).
    const html = markup(
      new Map([["armlab", render("https://cdn/lab.webp", 3)]]),
    );
    const [picture] = drawn(html, "image");
    const lab = drawn(html, "rect").find((rect) => rect.width > 1);
    if (!lab) throw new Error("expected the lab's square");

    const grow = BUILDING_GAP + 3;
    expect(picture.x).toBeCloseTo(lab.x - grow);
    expect(picture.width).toBeCloseTo(lab.width + grow * 2);
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

  it("colours a building by what it does, and leaves one it cannot place alone", () => {
    const shape = blueprintShape(LAYOUT);
    if (!shape) throw new Error("nothing to draw");
    const roles = buildingRoles([
      { name: "armsolar", stats: { energyMake: 20 } },
    ]);
    const html = renderToStaticMarkup(
      <LayoutPlan shape={shape} roles={roles} />,
    );
    const rects = [...html.matchAll(/<rect [^>]*>/g)].map((match) => match[0]);
    expect(rects[0]).toContain('fill="#f2cc40"');
    expect(rects[0]).toContain('stroke="#f2cc40"');
    // The lab is not in the game's units, so it keeps the plan's colour.
    expect(rects[1]).toContain('fill="currentColor"');
  });

  it("draws in the widget's building colour, not the theme accent (#4781)", () => {
    const html = markup();
    expect(html).toContain(`color:${BUILDING_CSS}`);
    expect(html).not.toContain("text-primary");
  });

  describe("terrain steps", () => {
    const WALL = {
      kind: "raise" as const,
      shape: "wall" as const,
      points: [
        { x: 0, z: 0 },
        { x: 160, z: 0 },
      ],
      height: 16,
      before: 0,
    };

    it("draws a layout of walls and no buildings", () => {
      const shape = blueprintShape({
        name: "Walls",
        buildings: [],
        footprints: {},
        terrain: [WALL],
      });
      if (!shape) throw new Error("nothing to draw");
      const html = renderToStaticMarkup(<LayoutPlan shape={shape} />);
      expect(html).toContain("text-blue-500");
      expect(html).not.toContain("<rect");
    });

    it("draws dug ground in the neutral tone and raised ground in blue", () => {
      const shape = blueprintShape({
        name: "Both",
        buildings: [],
        footprints: {},
        terrain: [WALL, { ...WALL, height: -16 }],
      });
      if (!shape) throw new Error("nothing to draw");
      const html = renderToStaticMarkup(<LayoutPlan shape={shape} />);
      expect(html).toContain("text-blue-500");
      expect(html).toContain("text-neutral-400");
    });

    it("draws steps before the buildings, so they are under them", () => {
      const shape = blueprintShape({
        ...LAYOUT,
        terrain: [
          {
            kind: "level",
            shape: "area",
            points: [
              { x: -80, z: -40 },
              { x: 80, z: -40 },
              { x: 80, z: 40 },
            ],
            height: 4,
            before: 0,
          },
        ],
      });
      if (!shape) throw new Error("nothing to draw");
      const html = renderToStaticMarkup(<LayoutPlan shape={shape} />);
      expect(html.indexOf("text-blue-500")).toBeGreaterThan(-1);
      expect(html.indexOf("text-blue-500")).toBeLessThan(html.indexOf("<rect"));
    });

    it("draws a neutral wall solid and faint with square ends, as the widget does", () => {
      const shape = blueprintShape({
        name: "Smooth",
        buildings: [],
        footprints: {},
        terrain: [{ ...WALL, kind: "smooth", height: undefined }],
      });
      if (!shape) throw new Error("nothing to draw");
      const html = renderToStaticMarkup(<LayoutPlan shape={shape} />);
      expect(html).not.toContain('stroke-dasharray="0.6');
      expect(html).toContain('stroke-linecap="square"');
      expect(html).toContain('stroke-opacity="0.3"');
    });

    it("draws an arrow on a ramp whose ends differ", () => {
      const ramp = (heights: [number, number]) => {
        const shape = blueprintShape({
          name: "Ramp",
          buildings: [],
          footprints: {},
          terrain: [
            {
              kind: "ramp",
              shape: "wall",
              points: [
                { x: 0, z: 0 },
                { x: 80, z: 0 },
              ],
              heights,
              width: 32,
              before: 0,
            },
          ],
        });
        if (!shape) throw new Error("nothing to draw");
        return renderToStaticMarkup(<LayoutPlan shape={shape} />);
      };
      const paths = (html: string) => html.match(/<path /g)?.length ?? 0;
      expect(paths(ramp([0, 20]))).toBe(paths(ramp([5, 5])) + 1);
    });
  });
});
