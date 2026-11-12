/**
 * The structures a sealed outpost is built from. Each family is one building
 * design from the references in the sealed outposts design, and each preset
 * here is one shape of it. A preset is built in the colourway it is given, so
 * the layer builds each pair of preset and colourway once.
 */
import type * as THREE from "three";
import { Builder } from "../landmarks/kit";
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

export const OUTPOSTS: readonly OutpostModel[] = [
  ...OUTPOST_DOMES,
  ...OUTPOST_INDUSTRY,
  ...OUTPOST_TOWERS,
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
