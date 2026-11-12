/**
 * The models a town is built from. An open town's are in `openTown.ts`, and
 * what it puts on a lot it leaves unbuilt is in `fillers.ts`. A sealed
 * outpost's structures are in `outposts.ts`. A model carries no foundation,
 * the layer adds one where the ground drops under a building.
 */
import type * as THREE from "three";
import type { SettlementStyle } from "../../planets";
import { Builder } from "../landmarks/kit";
import type { TownPalette } from "../landmarks/palettes";
import { FILLERS } from "./fillers";
import { OPEN_TOWN } from "./openTown";
import { OPEN_TOWN_DETAIL } from "./openTownDetail";
import { OPEN_TOWN_TALL } from "./openTownTall";

export interface BuildingModel {
  id: string;
  /** Lots along the block and across it. */
  lots: [number, number];
  /** Height in world units. */
  height: number;
  settlements: readonly SettlementStyle[];
  /** Set on what fills a lot nothing is built on: a park, a court, a car park. */
  filler?: boolean;
  /** Set on a town's one or two tallest towers, which only a city or a capital has. */
  landmark?: boolean;
  /** Add the model's parts round its own origin, standing on y = 0, inside `w` by `d`. */
  build(b: Builder, w: number, d: number, palette: TownPalette): void;
}

export const BUILDINGS: readonly BuildingModel[] = [
  ...OPEN_TOWN,
  ...OPEN_TOWN_DETAIL,
  ...OPEN_TOWN_TALL,
  ...FILLERS,
];

export function modelsFor(style: SettlementStyle): BuildingModel[] {
  return BUILDINGS.filter((m) => m.settlements.includes(style));
}

/** One model as a geometry, for copying to each place it stands. The caller owns it. */
export function buildModel(
  model: BuildingModel,
  w: number,
  d: number,
  palette: TownPalette,
): THREE.BufferGeometry {
  const builder = new Builder();
  model.build(builder, w, d, palette);
  return builder.build().solid;
}
