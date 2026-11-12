/**
 * Parts for a sealed outpost's structures and the plates they stand on. Each
 * adds itself to a landmark `Builder` in the colours of the paint it is given.
 */
import type * as THREE from "three";
import type { Builder } from "../landmarks/kit";
import type { OutpostPaint } from "./outpostColourways";
import { chamfered, column, type Pt } from "./parts";

/** How far a plate's deck stands above its origin. A structure stands on the deck. */
export const PLATE_DECK = 0.03;
/** The rim round a plate's deck: how high it stands above it and how wide it is. */
const RIM_HEIGHT = 0.012;
const RIM_WIDTH = 0.025;
/** How far a plate's corners are cut back. */
const PLATE_CHAMFER = 0.03;

/**
 * A foundation plate `w` by `d`, its deck at {@link PLATE_DECK} and its sides
 * reaching `depth` below its origin, with a hazard-striped rim round the
 * deck. `place` moves it into the builder's frame.
 */
export function foundationPlate(
  b: Builder,
  w: number,
  d: number,
  depth: number,
  paint: OutpostPaint,
  place: THREE.Matrix4,
): void {
  const c = Math.min(PLATE_CHAMFER, w / 4, d / 4);
  b.add(column(chamfered(w, d, c), -depth, PLATE_DECK), paint.trim, place, {
    kind: 11,
    top: paint.top,
    topCover: paint.topCover,
  });
  // The rim: a strip down each side, inside the plate's own edge.
  const y0 = PLATE_DECK;
  const y1 = PLATE_DECK + RIM_HEIGHT;
  const r = Math.min(RIM_WIDTH, w / 4, d / 4);
  const strips: Pt[][] = [
    side(-w / 2 + c, -d / 2, w / 2 - c, -d / 2 + r),
    side(-w / 2 + c, d / 2 - r, w / 2 - c, d / 2),
    side(-w / 2, -d / 2 + c, -w / 2 + r, d / 2 - c),
    side(w / 2 - r, -d / 2 + c, w / 2, d / 2 - c),
  ];
  for (const strip of strips)
    b.add(column(strip, y0, y1), paint.stripe, place, {
      kind: 14,
      clean: true,
    });
}

/** A rectangle on plan from `x0, z0` to `x1, z1`. */
const side = (x0: number, z0: number, x1: number, z1: number): Pt[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
