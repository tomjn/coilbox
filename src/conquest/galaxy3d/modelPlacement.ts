import type { ModelRef, PlacedModel } from "../placedModels";
import type { WorldPos } from "./layout";
import type { TerrainSurface } from "./terrain";

/**
 * The maths behind placed models: which entries share a model, and where each
 * copy goes in world space. Pure and free of three.js so it unit-tests without
 * WebGL. `placedModelsLayer.ts` turns the result into instanced meshes.
 */

/** Where one copy of a model goes, in world space. */
export interface InstanceTransform {
  /** World position of the model's origin. */
  position: WorldPos;
  /** Turn about world +Y in radians, as `Object3D.rotation.y` takes it. */
  rotationY: number;
  /** World units per unit of the model, the same on all three axes. */
  scale: number;
}

/** Every placement of one model. */
export interface ModelGroup {
  /** `game:` or `file:` followed by the name, unique to one model. */
  key: string;
  model: ModelRef;
  /** The name as the document gives it, for reporting a failure. */
  name: string;
  instances: InstanceTransform[];
}

/** The name a reference gives its model. */
export function modelRefName(ref: ModelRef): string {
  return "game" in ref ? ref.game : ref.file;
}

/** A key that is the same for two references to one model, and only then. */
export function modelRefKey(ref: ModelRef): string {
  return "game" in ref ? `game:${ref.game}` : `file:${ref.file}`;
}

/**
 * Where one entry goes. The position comes from the surface, the height from
 * the ground beneath it unless the entry gives its own, and the scale is the
 * entry's own multiplied by the surface's map to world factor, so a model at
 * scale 1 is as big against the map as its file says.
 */
export function instanceTransform(
  surface: Pick<TerrainSurface, "scale" | "mapToWorldXZ" | "groundHeightAt">,
  entry: PlacedModel,
): InstanceTransform {
  const [mapX, mapY] = entry.pos;
  const [x, z] = surface.mapToWorldXZ(mapX, mapY);
  const y =
    entry.height !== undefined
      ? entry.height * surface.scale
      : surface.groundHeightAt(mapX, mapY);
  return {
    position: [x, y, z],
    rotationY: ((entry.rotation ?? 0) * Math.PI) / 180,
    scale: (entry.scale ?? 1) * surface.scale,
  };
}

/**
 * Group a document's placed models by the model they draw, in the order each
 * model first appears, so a forest of one tree is one group however many trees
 * it has.
 */
export function groupPlacedModels(
  surface: Pick<TerrainSurface, "scale" | "mapToWorldXZ" | "groundHeightAt">,
  models: readonly PlacedModel[],
): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const entry of models) {
    const key = modelRefKey(entry.model);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        model: entry.model,
        name: modelRefName(entry.model),
        instances: [],
      };
      groups.set(key, group);
    }
    group.instances.push(instanceTransform(surface, entry));
  }
  return [...groups.values()];
}

/** Collects failed models, telling `warn` about each name once only. */
export interface FailureLog {
  /** Record that a model failed. A name already recorded is not told again. */
  report(name: string, reason: string): void;
  /** The names that failed, in the order they first did. */
  readonly failed: string[];
}

export function createFailureLog(warn: (message: string) => void): FailureLog {
  const failed: string[] = [];
  const seen = new Set<string>();
  return {
    failed,
    report(name, reason) {
      if (seen.has(name)) return;
      seen.add(name);
      failed.push(name);
      warn(`placed model "${name}" was not drawn: ${reason}`);
    },
  };
}
