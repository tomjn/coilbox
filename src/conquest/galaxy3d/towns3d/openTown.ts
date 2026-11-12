/**
 * The buildings of an open town: slab towers with round shoulders, chamfered
 * columns and low blocks under layered roof plates.
 *
 * A single lot is about ten pixels wide at the closest the camera comes, so
 * every part here is sized to change the outline or the roof at that zoom.
 * Nothing sets a human scale: no windows, doors or masts.
 *
 * A building is one colour from the planet in four finishes, so its masses
 * read apart in shade as well as in sun: pale cast walls, the same walls in
 * broad ribs, a darker cast and dark metal in the gaps. A few carry
 * a panel of the planet's rust.
 */
import type * as THREE from "three";
import { at, type Builder, type Paint } from "../landmarks/kit";
import type { TownPalette } from "../landmarks/palettes";
import type { BuildingModel } from "./buildings";
import { chamfered, column, plate, rect, shouldered } from "./parts";

const OPEN = ["organic"] as const;

/** How dark the second finish is beside the walls. */
const PLATE_TONE = 0.72;

type Add = (g: THREE.BufferGeometry) => void;

/** The finishes a model's parts are added in. */
interface Tools {
  /** Pale cast concrete: a building's main masses. */
  wall: Add;
  /** The same concrete in broad ribs. */
  ribs: Add;
  /** A darker cast than the walls: podiums, roof plates and lesser masses. */
  alt: Add;
  /** Dark metal: a recess, a core or a band between two masses. */
  dark: Add;
  /** A painted panel in the planet's rust. */
  accent: Add;
}

const tools = (b: Builder, palette: TownPalette): Tools => {
  const origin = at(0, 0, 0);
  // No grime at the foot: a building's foot is in its neighbours' shadow.
  const settled = { top: palette.top, topCover: palette.topCover, clean: true };
  const add =
    (color: TownPalette["building"], paint: Paint): Add =>
    (g) =>
      b.add(g, color, origin, paint);
  return {
    wall: add(palette.building, settled),
    ribs: add(palette.building, { ...settled, kind: 6 }),
    alt: add(palette.building, { ...settled, kind: 5, tint: () => PLATE_TONE }),
    // Bare metal takes the sun's glint and none of painted metal's scuffs,
    // which are drawn for a model many times a building's size.
    dark: add(palette.dark, { kind: 13, clean: true }),
    accent: add(palette.accent, { kind: 7, clean: true }),
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
  /* ------------------------------ one lot ------------------------------ */

  // A low block under two roof plates.
  model("low", [1, 1], 0.18, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.14 * w), 0, 0.6 * h));
    t.alt(plate(0.78 * w, 0.78 * d, 0.6 * h, 0.76 * h));
    t.wall(plate(0.42 * w, 0.56 * d, 0.76 * h, h, -0.12 * w, 0.08 * d));
  }),

  // A squat ribbed drum on a dark plinth.
  model("drum", [1, 1], 0.27, (t, w, d, h) => {
    const drum = chamfered(0.84 * w, 0.84 * d, 0.24 * w);
    t.alt(column(chamfered(w, d, 0.2 * w), 0, 0.3 * h));
    t.ribs(column(drum, 0.3 * h, 0.82 * h));
    t.wall(column(drum, 0.82 * h, h, chamfered(0.5 * w, 0.5 * d, 0.14 * w)));
  }),

  // A block that steps back twice to one side.
  model("mid", [1, 1], 0.375, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.12 * w), 0, 0.55 * h));
    t.alt(plate(0.3 * w, 0.8 * d, 0.55 * h, 0.62 * h, 0.3 * w, 0));
    t.ribs(plate(0.6 * w, 0.92 * d, 0.55 * h, 0.85 * h, -0.17 * w, 0));
    t.alt(plate(0.36 * w, 0.5 * d, 0.85 * h, h, -0.22 * w, -0.14 * d));
  }),

  // A plain block with a dark band round it and two housings on its roof.
  model("block", [1, 1], 0.5, (t, w, d, h) => {
    const body = chamfered(0.94 * w, 0.94 * d, 0.1 * w);
    t.wall(column(body, 0, 0.46 * h));
    t.dark(column(chamfered(0.88 * w, 0.88 * d, 0.09 * w), 0.46 * h, 0.56 * h));
    t.wall(column(body, 0.56 * h, 0.8 * h));
    t.alt(plate(0.5 * w, 0.7 * d, 0.8 * h, h, 0.16 * w, 0));
    t.wall(plate(0.26 * w, 0.4 * d, 0.8 * h, 0.9 * h, -0.28 * w, 0.1 * d));
  }),

  // A slab with round shoulders on a podium, a recess down one broad face.
  model("mid-tall", [1, 1], 0.675, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * w), 0, 0.16 * h));
    t.wall(shouldered(0.9 * w, 0.16 * h, h, 0.22 * w, -0.3 * d, 0.3 * d));
    t.alt(plate(0.6 * w, 0.2 * d, 0.16 * h, 0.6 * h, 0, -0.39 * d));
    t.dark(plate(0.22 * w, 0.03 * d, 0.22 * h, 0.82 * h, 0, 0.31 * d));
  }),

  // A slim core carrying three blocks, one above the other.
  model("stack", [1, 1], 0.9, (t, w, d, h) => {
    const block = chamfered(0.96 * w, 0.96 * d, 0.14 * w);
    t.alt(column(chamfered(0.62 * w, 0.62 * d, 0.1 * w), 0, 0.94 * h));
    t.ribs(column(block, 0.04 * h, 0.3 * h));
    t.ribs(column(block, 0.38 * h, 0.6 * h));
    t.wall(column(block, 0.68 * h, 0.86 * h));
    t.wall(plate(0.4 * w, 0.4 * d, 0.94 * h, h));
  }),

  // A chamfered column with a dark band round its waist and a narrow head.
  model("tower", [1, 1], 1.2, (t, w, d, h) => {
    const shaft = chamfered(0.8 * w, 0.8 * d, 0.2 * w);
    const head = chamfered(0.5 * w, 0.5 * d, 0.12 * w);
    t.alt(column(chamfered(w, d, 0.24 * w), 0, 0.12 * h));
    t.wall(column(shaft, 0.12 * h, 0.84 * h));
    t.dark(column(chamfered(0.96 * w, 0.96 * d, 0.24 * w), 0.5 * h, 0.55 * h));
    t.wall(column(shaft, 0.84 * h, 0.92 * h, head));
    t.alt(column(head, 0.92 * h, h));
  }),

  // A broad lower half and a narrower ribbed upper half set to one side, with
  // a painted panel on the lower.
  model("split", [1, 1], 1.5, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.12 * w), 0, 0.5 * h));
    t.dark(plate(0.8 * w, 0.8 * d, 0.5 * h, 0.54 * h));
    t.ribs(
      column(
        chamfered(0.66 * w, 0.9 * d, 0.1 * w, -0.15 * w, 0),
        0.54 * h,
        0.94 * h,
      ),
    );
    t.accent(plate(0.03 * w, 0.5 * d, 0.2 * h, 0.46 * h, -0.485 * w, 0));
    t.alt(plate(0.26 * w, 0.6 * d, 0.54 * h, 0.7 * h, 0.33 * w, 0));
    t.wall(plate(0.4 * w, 0.5 * d, 0.94 * h, h, -0.2 * w, 0));
  }),

  // Two thin slabs of different heights with a dark core between them.
  model("tall-tower", [1, 1], 1.8, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * w), 0, 0.07 * h));
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
    t.dark(plate(0.26 * w, 0.6 * d, 0.07 * h, 0.76 * h));
    t.alt(plate(0.94 * w, 0.44 * d, 0.56 * h, 0.59 * h));
  }),

  // A slim shaft that narrows to a blunt head, a lower slab against one face.
  model("spire", [1, 1], 2.1, (t, w, d, h) => {
    const shaft = chamfered(0.7 * w, 0.7 * d, 0.16 * w, 0.1 * w, 0);
    const neck = chamfered(0.44 * w, 0.44 * d, 0.1 * w, 0.1 * w, 0);
    t.alt(column(chamfered(w, d, 0.14 * w), 0, 0.06 * h));
    t.wall(column(shaft, 0.06 * h, 0.62 * h));
    t.ribs(column(shaft, 0.62 * h, 0.74 * h));
    t.wall(column(shaft, 0.74 * h, 0.9 * h, neck));
    t.wall(column(neck, 0.9 * h, h));
    t.alt(
      shouldered(
        0.7 * d,
        0.06 * h,
        0.46 * h,
        0.2 * d,
        -0.48 * w,
        -0.24 * w,
        0,
        true,
      ),
    );
  }),

  /* ------------------------------ two lots ----------------------------- */

  // A long low block, a plate over it and two housings of different heights.
  model("low-slab", [2, 1], 0.3, (t, w, d, h) => {
    t.wall(column(chamfered(w, d, 0.1 * d), 0, 0.5 * h));
    t.alt(plate(0.9 * w, 0.8 * d, 0.5 * h, 0.62 * h));
    t.wall(plate(0.3 * w, 0.6 * d, 0.62 * h, h, -0.26 * w, 0));
    t.ribs(plate(0.4 * w, 0.36 * d, 0.62 * h, 0.82 * h, 0.2 * w, -0.1 * d));
  }),

  // A long ribbed hall with round shoulders between two end blocks.
  model("hall", [2, 1], 0.55, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * d), 0, 0.12 * h));
    t.ribs(
      shouldered(
        0.8 * d,
        0.12 * h,
        0.8 * h,
        0.26 * d,
        -0.34 * w,
        0.34 * w,
        0,
        true,
      ),
    );
    t.wall(
      column(chamfered(0.16 * w, 0.96 * d, 0.1 * d, -0.41 * w, 0), 0.12 * h, h),
    );
    t.wall(
      column(
        chamfered(0.16 * w, 0.96 * d, 0.1 * d, 0.41 * w, 0),
        0.12 * h,
        0.9 * h,
      ),
    );
    t.dark(plate(0.5 * w, 0.14 * d, 0.8 * h, 0.86 * h));
  }),

  // A long slab with round shoulders, a pylon standing over one end.
  model("slab", [2, 1], 0.9, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * d), 0, 0.1 * h));
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
    t.alt(
      column(chamfered(0.2 * w, 0.96 * d, 0.14 * d, 0.39 * w, 0), 0.1 * h, h),
    );
    t.dark(plate(0.44 * w, 0.26 * d, 0.88 * h, 0.94 * h, -0.1 * w, 0));
    t.accent(plate(0.3 * w, 0.02 * d, 0.3 * h, 0.6 * h, -0.2 * w, 0.42 * d));
  }),

  // A great wall of a slab whose head slopes up to a buttress at one end,
  // with a dark band across it.
  model("wall", [2, 1], 1.4, (t, w, d, h) => {
    const body = rect(0.78 * w, 0.72 * d, -0.08 * w, 0);
    t.alt(column(chamfered(w, d, 0.1 * d), 0, 0.07 * h));
    t.wall(column(body, 0.07 * h, 0.5 * h));
    t.dark(plate(0.74 * w, 0.66 * d, 0.5 * h, 0.54 * h, -0.08 * w, 0));
    t.wall(column(body, 0.54 * h, 0.78 * h));
    t.ribs(
      column(body, 0.78 * h, 0.94 * h, rect(0.3 * w, 0.6 * d, 0.14 * w, 0)),
    );
    t.alt(
      column(chamfered(0.2 * w, 0.96 * d, 0.12 * d, 0.39 * w, 0), 0.07 * h, h),
    );
  }),

  /* ------------------------------ four lots ---------------------------- */

  // A low wide block under a roof plate and three housings.
  model("plaza", [2, 2], 0.45, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.1 * w), 0, 0.36 * h));
    t.wall(plate(0.86 * w, 0.86 * d, 0.36 * h, 0.52 * h));
    t.ribs(plate(0.4 * w, 0.5 * d, 0.52 * h, 0.84 * h, -0.2 * w, -0.14 * d));
    t.wall(plate(0.3 * w, 0.3 * d, 0.52 * h, h, 0.24 * w, 0.24 * d));
    t.alt(plate(0.3 * w, 0.24 * d, 0.52 * h, 0.7 * h, 0.24 * w, -0.22 * d));
    t.dark(plate(0.44 * w, 0.1 * d, 0.52 * h, 0.58 * h, -0.18 * w, 0.3 * d));
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
      t.alt(
        column(
          rect(0.14 * w, 0.4 * d, side * 0.43 * w, 0),
          0,
          0.52 * h,
          rect(0.1 * w, 0.3 * d, side * 0.4 * w, 0),
        ),
      );
    t.ribs(
      column(
        chamfered(0.66 * w, 0.72 * d, 0.1 * w),
        0.42 * h,
        0.72 * h,
        chamfered(0.58 * w, 0.64 * d, 0.09 * w),
      ),
    );
    t.dark(plate(0.44 * w, 0.5 * d, 0.72 * h, 0.79 * h));
    t.wall(
      column(
        chamfered(0.26 * w, 0.3 * d, 0.05 * w, 0.06 * w, -0.08 * d),
        0.79 * h,
        h,
      ),
    );
  }),

  // A battered keep with a ribbed crown and a pylon at two opposite corners.
  model("citadel", [2, 2], 1.3, (t, w, d, h) => {
    const crown = chamfered(0.68 * w, 0.68 * d, 0.12 * w);
    t.alt(column(chamfered(w, d, 0.14 * w), 0, 0.08 * h));
    t.wall(
      column(
        chamfered(0.86 * w, 0.86 * d, 0.16 * w),
        0.08 * h,
        0.62 * h,
        crown,
      ),
    );
    t.dark(column(chamfered(0.6 * w, 0.6 * d, 0.1 * w), 0.62 * h, 0.66 * h));
    t.ribs(column(crown, 0.66 * h, 0.86 * h));
    t.wall(plate(0.36 * w, 0.36 * d, 0.86 * h, 0.93 * h));
    for (const side of [-1, 1])
      t.alt(
        column(
          chamfered(
            0.2 * w,
            0.2 * d,
            0.04 * w,
            side * 0.38 * w,
            side * 0.38 * d,
          ),
          0.08 * h,
          (side < 0 ? 1 : 0.8) * h,
        ),
      );
  }),

  // A great slab with a narrow head, and a lower slab against each broad face.
  model("great-tower", [2, 2], 2.4, (t, w, d, h) => {
    const body = chamfered(0.9 * w, 0.52 * d, 0.12 * w);
    const head = chamfered(0.56 * w, 0.36 * d, 0.09 * w);
    t.alt(column(chamfered(w, d, 0.1 * w), 0, 0.08 * h));
    t.wall(column(body, 0.08 * h, 0.8 * h));
    t.wall(column(body, 0.8 * h, 0.9 * h, head));
    t.ribs(column(head, 0.9 * h, h));
    t.alt(shouldered(0.5 * w, 0.08 * h, 0.52 * h, 0.1 * w, 0.24 * d, 0.47 * d));
    t.alt(
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
    t.dark(plate(0.16 * w, 0.03 * d, 0.54 * h, 0.78 * h, 0, 0.27 * d));
    t.accent(plate(0.03 * w, 0.3 * d, 0.3 * h, 0.5 * h, -0.46 * w, 0));
  }),

  // Two great slabs of different heights, a dark core between them and two
  // bridges across it.
  model("twin", [2, 2], 3.0, (t, w, d, h) => {
    t.alt(column(chamfered(w, d, 0.12 * w), 0, 0.05 * h));
    t.wall(
      shouldered(
        0.7 * d,
        0.05 * h,
        h,
        0.22 * d,
        -0.46 * w,
        -0.12 * w,
        0.06 * d,
        true,
      ),
    );
    t.wall(
      shouldered(
        0.7 * d,
        0.05 * h,
        0.82 * h,
        0.22 * d,
        0.12 * w,
        0.46 * w,
        -0.06 * d,
        true,
      ),
    );
    t.dark(plate(0.26 * w, 0.44 * d, 0.05 * h, 0.74 * h));
    t.alt(plate(0.9 * w, 0.3 * d, 0.36 * h, 0.39 * h));
    t.alt(plate(0.9 * w, 0.3 * d, 0.62 * h, 0.65 * h));
    t.ribs(plate(0.3 * w, 0.2 * d, 0.05 * h, 0.3 * h, -0.29 * w, -0.39 * d));
  }),

  // A capsule: a great slab that widens from a narrow foot and closes to a
  // blunt head, a recess down each broad face and a lower slab at each end.
  model("supertall", [2, 2], 3.6, (t, w, d, h) => {
    const foot = chamfered(0.5 * w, 0.4 * d, 0.1 * w);
    const shaft = chamfered(0.7 * w, 0.56 * d, 0.16 * w);
    const neck = chamfered(0.52 * w, 0.42 * d, 0.12 * w);
    const head = chamfered(0.3 * w, 0.26 * d, 0.07 * w);
    t.alt(column(chamfered(w, d, 0.16 * w), 0, 0.04 * h));
    t.wall(column(foot, 0.04 * h, 0.16 * h, shaft));
    t.wall(column(shaft, 0.16 * h, 0.8 * h));
    t.ribs(column(shaft, 0.8 * h, 0.93 * h, neck));
    t.wall(column(neck, 0.93 * h, h, head));
    for (const side of [-1, 1]) {
      t.dark(
        plate(0.14 * w, 0.03 * d, 0.24 * h, 0.76 * h, 0, side * 0.285 * d),
      );
      t.alt(
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
