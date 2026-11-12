/**
 * The structures a sealed outpost is built from. Each family is one building
 * design from the references in the sealed outposts design, and each preset
 * here is one shape of it. A preset is built in the colourway it is given, so
 * the layer builds each pair of preset and colourway once.
 *
 * The plain cuboids at the end stand in until every family is built.
 */
import type * as THREE from "three";
import { at, Builder, box } from "../landmarks/kit";
import type { OutpostFamily, OutpostPaint } from "./outpostColourways";
import { OUTPOST_DOMES } from "./outpostDomes";
import { OUTPOST_INDUSTRY } from "./outpostIndustry";
import { OUTPOST_TOWERS } from "./outpostTowers";

export interface OutpostModel {
  id: string;
  family: OutpostFamily;
  /** Lots along the outpost's axis and across it. */
  lots: [number, number];
  /** Height in world units. */
  height: number;
  /** Set on a centrepiece, which only a city or a capital has. */
  landmark?: boolean;
  /** Set on a structure round on plan, which may stand at any turn. */
  round?: boolean;
  /** Add the structure's parts round its own origin, standing on y = 0, inside `w` by `d`. */
  build(b: Builder, w: number, d: number, paint: OutpostPaint): void;
}

/** A plain block standing in for a family not yet built. */
const placeholder = (
  id: string,
  lots: [number, number],
  height: number,
): OutpostModel => ({
  id,
  family: "placeholder",
  lots,
  height,
  build(b, w, d, paint) {
    b.add(box(w, height, d, 0, 0.4), paint.hull, at(0, 0, 0), {
      kind: 11,
      top: paint.top,
      topCover: paint.topCover,
      stains: paint.dust,
    });
  },
});

export const OUTPOSTS: readonly OutpostModel[] = [
  ...OUTPOST_DOMES,
  ...OUTPOST_INDUSTRY,
  ...OUTPOST_TOWERS,
  placeholder("outpost-low", [1, 1], 0.18),
  placeholder("outpost-low-slab", [2, 1], 0.3),
  placeholder("outpost-mid", [1, 1], 0.375),
  placeholder("outpost-mid-tall", [1, 1], 0.675),
  placeholder("outpost-podium", [2, 2], 0.75),
  placeholder("outpost-slab", [2, 1], 0.9),
  placeholder("outpost-tower", [1, 1], 1.2),
  placeholder("outpost-tall-tower", [1, 1], 1.8),
  placeholder("outpost-great-tower", [2, 2], 2.4),
  placeholder("outpost-supertall", [2, 2], 3.6),
];

/** One structure in one colourway as a geometry. The caller owns it. */
export function buildOutpost(
  model: OutpostModel,
  w: number,
  d: number,
  paint: OutpostPaint,
): THREE.BufferGeometry {
  const builder = new Builder();
  model.build(builder, w, d, paint);
  return builder.build().solid;
}
