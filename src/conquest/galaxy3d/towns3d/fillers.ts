/**
 * What an open town puts on a lot it does not build on: parks, courts, a
 * pitch, a car park, a playground and a paved square. Each is a few flat
 * patches of colour and some low shapes, because a lot is about ten pixels
 * wide at the closest the camera comes and nothing finer shows.
 */
import type * as THREE from "three";
import { at, type Builder, type Rgb } from "../landmarks/kit";
import type { TownPalette } from "../landmarks/palettes";
import type { BuildingModel } from "./buildings";
import { chamfered, column, type Pt, plate } from "./parts";

const OPEN = ["organic"] as const;

const CLAY: Rgb = [172, 98, 72];
const COURT: Rgb = [78, 112, 146];
const LINE: Rgb = [224, 224, 214];
const ASPHALT: Rgb = [66, 66, 70];
const WATER: Rgb = [84, 128, 152];
const SAND: Rgb = [204, 188, 150];
const CARS: readonly Rgb[] = [
  [204, 204, 198],
  [76, 80, 90],
  [150, 66, 54],
  [186, 168, 112],
];
const PLAY: readonly Rgb[] = [
  [182, 88, 68],
  [204, 170, 86],
  [86, 122, 160],
];

type Put = (g: THREE.BufferGeometry, colour: Rgb) => void;

const filler = (
  id: string,
  lots: [number, number],
  height: number,
  /** Add the parts. `h` is the model's height. */
  parts: (
    put: Put,
    w: number,
    d: number,
    h: number,
    palette: TownPalette,
  ) => void,
): BuildingModel => ({
  id,
  lots,
  height,
  filler: true,
  settlements: OPEN,
  build(b: Builder, w, d, palette) {
    const origin = at(0, 0, 0);
    // Flat paint with no pattern: these are grounds, not walls.
    const put: Put = (g, colour) =>
      b.add(g, colour, origin, { kind: 7, clean: true });
    parts(put, w, d, height, palette);
  },
});

/** A tree: an eight sided crown that narrows to its top, `s` across at `cx, cz`. */
const tree = (
  s: number,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
): THREE.BufferGeometry => {
  const plan = (size: number): Pt[] =>
    chamfered(size, size, 0.3 * size, cx, cz);
  return column(plan(s), y0, y1, plan(0.55 * s));
};

export const FILLERS: readonly BuildingModel[] = [
  // Grass, a path across it and five trees.
  filler("park", [1, 1], 0.09, (put, w, d, h, p) => {
    const s = 0.24 * Math.min(w, d);
    put(column(chamfered(w, d, 0.08 * w), 0, 0.3 * h), p.grass);
    put(plate(0.1 * w, d, 0.3 * h, 0.33 * h, 0.08 * w, 0), p.pavement);
    put(tree(s, -0.3 * w, -0.3 * d, 0.3 * h, h), p.tree);
    put(tree(0.8 * s, -0.32 * w, 0.04 * d, 0.3 * h, 0.8 * h), p.tree);
    put(tree(s, -0.24 * w, 0.32 * d, 0.3 * h, 0.9 * h), p.tree);
    put(tree(0.9 * s, 0.32 * w, -0.22 * d, 0.3 * h, 0.86 * h), p.tree);
    put(tree(s, 0.3 * w, 0.26 * d, 0.3 * h, 0.95 * h), p.tree);
  }),

  // Grass round a pond, three trees along one side.
  filler("garden", [1, 1], 0.075, (put, w, d, h, p) => {
    const s = 0.22 * Math.min(w, d);
    put(column(chamfered(w, d, 0.08 * w), 0, 0.36 * h), p.grass);
    put(
      column(
        chamfered(0.5 * w, 0.44 * d, 0.14 * w, 0.12 * w, 0.1 * d),
        0.36 * h,
        0.4 * h,
      ),
      WATER,
    );
    put(tree(s, -0.32 * w, -0.3 * d, 0.36 * h, h), p.tree);
    put(tree(0.85 * s, -0.02 * w, -0.34 * d, 0.36 * h, 0.84 * h), p.tree);
    put(tree(s, -0.34 * w, 0.12 * d, 0.36 * h, 0.92 * h), p.tree);
  }),

  // Two courts side by side, one clay and one hard, each with its net.
  filler("courts", [1, 1], 0.036, (put, w, d, h, p) => {
    put(plate(w, d, 0, 0.72 * h), p.grass);
    [CLAY, COURT].forEach((colour, i) => {
      const cx = (i - 0.5) * 0.48 * w;
      put(plate(0.42 * w, 0.88 * d, 0.72 * h, 0.8 * h, cx, 0), LINE);
      put(plate(0.36 * w, 0.8 * d, 0.8 * h, 0.9 * h, cx, 0), colour);
      put(plate(0.4 * w, 0.04 * d, 0.9 * h, h, cx, 0), LINE);
    });
  }),

  // Tarmac and two rows of parked cars.
  filler("car-park", [1, 1], 0.045, (put, w, d, h) => {
    put(plate(w, d, 0, 0.6 * h), ASPHALT);
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 4; i++) {
        // One bay in each row stands empty.
        if (i === (row === 0 ? 2 : 0)) continue;
        put(
          plate(
            0.14 * w,
            0.26 * d,
            0.6 * h,
            (i % 2 === 0 ? 1 : 0.9) * h,
            (i - 1.5) * 0.22 * w,
            (row - 0.5) * 0.5 * d,
          ),
          CARS[(i + row * 2) % CARS.length],
        );
      }
  }),

  // Sand, a patch of grass and three pieces of play equipment.
  filler("playground", [1, 1], 0.06, (put, w, d, h, p) => {
    put(column(chamfered(w, d, 0.1 * w), 0, 0.45 * h), SAND);
    put(plate(0.4 * w, 0.9 * d, 0.45 * h, 0.5 * h, -0.26 * w, 0), p.grass);
    put(plate(0.26 * w, 0.14 * d, 0.45 * h, h, 0.2 * w, -0.24 * d), PLAY[0]);
    put(
      column(
        chamfered(0.22 * w, 0.22 * d, 0.06 * w, 0.22 * w, 0.2 * d),
        0.45 * h,
        0.8 * h,
      ),
      PLAY[1],
    );
    put(
      plate(0.1 * w, 0.3 * d, 0.45 * h, 0.7 * h, -0.02 * w, 0.06 * d),
      PLAY[2],
    );
    put(
      tree(0.2 * Math.min(w, d), -0.3 * w, -0.26 * d, 0.5 * h, 0.95 * h),
      p.tree,
    );
  }),

  // A paved square with a pool, a plinth in it and a tree at two corners.
  filler("square", [1, 1], 0.085, (put, w, d, h, p) => {
    const s = 0.2 * Math.min(w, d);
    put(plate(w, d, 0, 0.32 * h), p.building);
    put(
      column(chamfered(0.56 * w, 0.56 * d, 0.16 * w), 0.32 * h, 0.38 * h),
      WATER,
    );
    put(
      column(chamfered(0.16 * w, 0.16 * d, 0.04 * w), 0.38 * h, h),
      p.building,
    );
    put(tree(s, -0.36 * w, -0.36 * d, 0.32 * h, 0.8 * h), p.tree);
    put(tree(s, 0.36 * w, 0.36 * d, 0.32 * h, 0.8 * h), p.tree);
  }),

  // A pitch inside a running track.
  filler("pitch", [2, 1], 0.03, (put, w, d, h, p) => {
    put(column(chamfered(w, d, 0.34 * d), 0, 0.76 * h), CLAY);
    put(
      column(chamfered(0.8 * w, 0.66 * d, 0.2 * d), 0.76 * h, 0.9 * h),
      p.grass,
    );
    put(plate(0.02 * w, 0.62 * d, 0.9 * h, h), LINE);
  }),

  // A long park: grass, a pond, a path and seven trees.
  filler("long-park", [2, 1], 0.1, (put, w, d, h, p) => {
    const s = 0.26 * Math.min(w, d);
    put(column(chamfered(w, d, 0.1 * d), 0, 0.27 * h), p.grass);
    put(
      column(
        chamfered(0.3 * w, 0.44 * d, 0.14 * d, 0.2 * w, -0.08 * d),
        0.27 * h,
        0.3 * h,
      ),
      WATER,
    );
    put(plate(0.96 * w, 0.1 * d, 0.27 * h, 0.3 * h, 0, 0.3 * d), p.pavement);
    const trees: [number, number, number][] = [
      [-0.41, -0.3, 1],
      [-0.3, -0.06, 0.85],
      [-0.4, 0.06, 0.9],
      [-0.16, -0.32, 0.95],
      [-0.02, -0.1, 0.8],
      [0.4, -0.3, 0.9],
      [0.41, 0.02, 1],
    ];
    for (const [x, z, top] of trees)
      put(tree(s, x * w, z * d, 0.27 * h, top * h), p.tree);
  }),
];
