/**
 * The models a town is built from. An open town's are in `openTown.ts`. A
 * sealed outpost's are still plain cuboids that stand in for the real models
 * to come. A model carries no foundation, the layer adds one where the ground
 * drops under a building.
 */
import type * as THREE from "three";
import type { SettlementStyle } from "../../planets";
import { at, Builder, box } from "../landmarks/kit";
import type { TownPalette } from "../landmarks/palettes";
import { OPEN_TOWN } from "./openTown";

export interface BuildingModel {
  id: string;
  /** Lots along the block and across it. */
  lots: [number, number];
  /** Height in world units. */
  height: number;
  settlements: readonly SettlementStyle[];
  /** Add the model's parts round its own origin, standing on y = 0, inside `w` by `d`. */
  build(b: Builder, w: number, d: number, palette: TownPalette): void;
}

const SEALED: readonly SettlementStyle[] = ["sealed"];

/** A cuboid standing in for a sealed outpost's model, in the planet's wall colour. */
const cuboid = (
  id: string,
  lots: [number, number],
  height: number,
): BuildingModel => ({
  id,
  lots,
  height,
  settlements: SEALED,
  build(b, w, d, palette) {
    b.add(box(w, height, d, 0, 0.4), palette.building, at(0, 0, 0), {
      top: palette.top,
      topCover: palette.topCover,
    });
  },
});

export const BUILDINGS: readonly BuildingModel[] = [
  ...OPEN_TOWN,
  cuboid("outpost-low", [1, 1], 0.18),
  cuboid("outpost-low-slab", [2, 1], 0.3),
  cuboid("outpost-mid", [1, 1], 0.375),
  cuboid("outpost-mid-tall", [1, 1], 0.675),
  cuboid("outpost-podium", [2, 2], 0.75),
  cuboid("outpost-slab", [2, 1], 0.9),
  cuboid("outpost-tower", [1, 1], 1.2),
  cuboid("outpost-tall-tower", [1, 1], 1.8),
  cuboid("outpost-great-tower", [2, 2], 2.4),
  cuboid("outpost-supertall", [2, 2], 3.6),
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
