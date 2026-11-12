/**
 * The buildings of an open town: slab towers with round shoulders, chamfered
 * columns and low blocks under layered roof plates, all in the planet's one
 * wall colour.
 *
 * A single lot is about ten pixels wide at the closest the camera comes, so
 * every part here is sized to change the outline or the roof at that zoom.
 * Nothing sets a human scale: no windows, doors or masts.
 */
import type * as THREE from "three";
import { at, type Builder, box, type Paint } from "../landmarks/kit";
import type { TownPalette } from "../landmarks/palettes";
import type { BuildingModel } from "./buildings";
import { chamfered, column, rect, shouldered } from "./parts";

const OPEN = ["organic"] as const;

/** How dark a recess between two masses is drawn. */
const RECESS = 0.5;

/** What a model's build function draws with. */
interface Tools {
  /** Add a part in the wall colour. Its upward faces take what settles on the planet's roofs. */
  wall(g: THREE.BufferGeometry): void;
  /** Add a box of `w` by `d` from `y0` to `y1` round `cx, cz`. */
  plate(
    w: number,
    d: number,
    y0: number,
    y1: number,
    cx?: number,
    cz?: number,
  ): void;
  /** Add a dark part with no pattern: the gap between two masses. */
  recess(g: THREE.BufferGeometry): void;
}

const tools = (b: Builder, palette: TownPalette): Tools => {
  // No grime at the foot: a building's foot is in its neighbours' shadow.
  const roofed: Paint = {
    top: palette.top,
    topCover: palette.topCover,
    clean: true,
  };
  const origin = at(0, 0, 0);
  const wall = (g: THREE.BufferGeometry) =>
    b.add(g, palette.building, origin, roofed);
  return {
    wall,
    plate: (w, d, y0, y1, cx = 0, cz = 0) =>
      b.add(box(w, y1 - y0, d, 0, 1), palette.building, at(cx, y0, cz), roofed),
    recess: (g) =>
      b.add(g, palette.building, origin, {
        kind: 7,
        clean: true,
        tint: () => RECESS,
      }),
  };
};

const model = (
  id: string,
  lots: [number, number],
  height: number,
  /** Add the parts. `h` is the model's height. */
  parts: (t: Tools, w: number, d: number, h: number) => void,
): BuildingModel => ({
  id,
  lots,
  height,
  settlements: OPEN,
  build(b, w, d, palette) {
    parts(tools(b, palette), w, d, height);
  },
});

export const OPEN_TOWN: readonly BuildingModel[] = [
  // A low block under two roof plates.
  model("low", [1, 1], 0.18, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.14 * w), 0, 0.6 * h));
    t.plate(0.78 * w, 0.78 * d, 0.6 * h, 0.76 * h);
    t.wall(column(rect(0.42 * w, 0.56 * d, -0.12 * w, 0.08 * d), 0.76 * h, h));
  }),

  // A long low block, a plate over it and two housings of different heights.
  model("low-slab", [2, 1], 0.3, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.1 * d), 0, 0.5 * h));
    t.plate(0.9 * w, 0.8 * d, 0.5 * h, 0.62 * h);
    t.wall(column(rect(0.3 * w, 0.6 * d, -0.26 * w, 0), 0.62 * h, h));
    t.wall(
      column(rect(0.4 * w, 0.36 * d, 0.2 * w, -0.1 * d), 0.62 * h, 0.82 * h),
    );
  }),

  // A block that steps back twice to one side.
  model("mid", [1, 1], 0.375, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.12 * w), 0, 0.55 * h));
    t.plate(0.3 * w, 0.8 * d, 0.55 * h, 0.62 * h, 0.3 * w, 0);
    t.wall(column(rect(0.6 * w, 0.92 * d, -0.17 * w, 0), 0.55 * h, 0.85 * h));
    t.wall(column(rect(0.36 * w, 0.5 * d, -0.22 * w, -0.14 * d), 0.85 * h, h));
  }),

  // A slab with round shoulders on a podium, a recess down each broad face.
  model("mid-tall", [1, 1], 0.675, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.1 * w), 0, 0.16 * h));
    t.wall(shouldered(0.9 * w, 0.16 * h, h, 0.22 * w, -0.3 * d, 0.3 * d));
    t.wall(column(rect(0.6 * w, 0.2 * d, 0, -0.39 * d), 0.16 * h, 0.6 * h));
    t.recess(column(rect(0.22 * w, 0.03 * d, 0, 0.31 * d), 0.22 * h, 0.82 * h));
  }),

  // A broad block of battered tiers with a buttress on two sides.
  model("podium", [2, 2], 0.75, (t, w, d, h) => {
    t.wall(
      column(
        chamfered(0.84 * w, d, 0.12 * w),
        0,
        0.42 * h,
        chamfered(0.76 * w, 0.9 * d, 0.11 * w),
      ),
    );
    for (const side of [-1, 1])
      t.wall(
        column(
          rect(0.14 * w, 0.4 * d, side * 0.43 * w, 0),
          0,
          0.52 * h,
          rect(0.1 * w, 0.3 * d, side * 0.4 * w, 0),
        ),
      );
    t.wall(
      column(
        chamfered(0.66 * w, 0.72 * d, 0.1 * w),
        0.42 * h,
        0.72 * h,
        chamfered(0.58 * w, 0.64 * d, 0.09 * w),
      ),
    );
    t.plate(0.44 * w, 0.5 * d, 0.72 * h, 0.79 * h);
    t.wall(
      column(
        chamfered(0.26 * w, 0.3 * d, 0.05 * w, 0.06 * w, -0.08 * d),
        0.79 * h,
        h,
      ),
    );
  }),

  // A long slab with round shoulders, a pylon standing over one end.
  model("slab", [2, 1], 0.9, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.1 * d), 0, 0.1 * h));
    t.wall(
      shouldered(
        0.84 * d,
        0.1 * h,
        0.88 * h,
        0.24 * d,
        -0.47 * w,
        0.3 * w,
        0,
        true,
      ),
    );
    t.wall(
      column(chamfered(0.2 * w, 0.96 * d, 0.14 * d, 0.39 * w, 0), 0.1 * h, h),
    );
    t.plate(0.44 * w, 0.26 * d, 0.88 * h, 0.94 * h, -0.1 * w, 0);
  }),

  // A chamfered column with a band round its waist and a narrow head.
  model("tower", [1, 1], 1.2, (t, w, d, h) => {
    const shaft = chamfered(0.8 * w, 0.8 * d, 0.2 * w);
    const head = chamfered(0.5 * w, 0.5 * d, 0.12 * w);
    t.wall(column(chamfered(w, d, 0.24 * w), 0, 0.12 * h));
    t.wall(column(shaft, 0.12 * h, 0.84 * h));
    t.wall(column(chamfered(0.96 * w, 0.96 * d, 0.24 * w), 0.5 * h, 0.55 * h));
    t.wall(column(shaft, 0.84 * h, 0.92 * h, head));
    t.wall(column(head, 0.92 * h, h));
  }),

  // Two thin slabs of different heights with a dark core between them.
  model("tall-tower", [1, 1], 1.8, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.1 * w), 0, 0.07 * h));
    t.wall(
      shouldered(0.9 * d, 0.07 * h, h, 0.3 * d, -0.47 * w, -0.12 * w, 0, true),
    );
    t.wall(
      shouldered(
        0.9 * d,
        0.07 * h,
        0.84 * h,
        0.3 * d,
        0.12 * w,
        0.47 * w,
        0,
        true,
      ),
    );
    t.recess(column(rect(0.26 * w, 0.6 * d), 0.07 * h, 0.76 * h));
    t.plate(0.94 * w, 0.44 * d, 0.56 * h, 0.59 * h);
  }),

  // A great slab with a narrow head, and a lower slab against each broad face.
  model("great-tower", [2, 2], 2.4, (t, w, d, h) => {
    const body = chamfered(0.9 * w, 0.52 * d, 0.12 * w);
    const head = chamfered(0.56 * w, 0.36 * d, 0.09 * w);
    t.wall(column(chamfered(w, d, 0.1 * w), 0, 0.08 * h));
    t.wall(column(body, 0.08 * h, 0.8 * h));
    t.wall(column(body, 0.8 * h, 0.9 * h, head));
    t.wall(column(head, 0.9 * h, h));
    t.wall(
      shouldered(0.5 * w, 0.08 * h, 0.52 * h, 0.1 * w, 0.24 * d, 0.47 * d),
    );
    t.wall(
      shouldered(
        0.36 * w,
        0.08 * h,
        0.66 * h,
        0.08 * w,
        -0.47 * d,
        -0.24 * d,
        -0.14 * w,
      ),
    );
    t.recess(column(rect(0.16 * w, 0.03 * d, 0, 0.27 * d), 0.54 * h, 0.78 * h));
  }),

  // A capsule: a great slab that widens from a narrow foot and closes to a
  // blunt head, a recess down each broad face and a lower slab at each end.
  model("supertall", [2, 2], 3.6, (t, w, d, h) => {
    const foot = chamfered(0.5 * w, 0.4 * d, 0.1 * w);
    const shaft = chamfered(0.7 * w, 0.56 * d, 0.16 * w);
    const neck = chamfered(0.52 * w, 0.42 * d, 0.12 * w);
    const head = chamfered(0.3 * w, 0.26 * d, 0.07 * w);
    t.wall(column(chamfered(w, d, 0.16 * w), 0, 0.04 * h));
    t.wall(column(foot, 0.04 * h, 0.16 * h, shaft));
    t.wall(column(shaft, 0.16 * h, 0.8 * h));
    t.wall(column(shaft, 0.8 * h, 0.93 * h, neck));
    t.wall(column(neck, 0.93 * h, h, head));
    for (const side of [-1, 1]) {
      t.recess(
        column(
          rect(0.14 * w, 0.03 * d, 0, side * 0.285 * d),
          0.24 * h,
          0.76 * h,
        ),
      );
      t.wall(
        shouldered(
          0.4 * d,
          0.04 * h,
          (side < 0 ? 0.62 : 0.48) * h,
          0.1 * d,
          side * 0.33 * w,
          side * 0.47 * w,
          0,
          true,
        ),
      );
    }
  }),
];
