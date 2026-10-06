import type { TerrainPixels } from "./galaxy3d/terrainLoad";
import type { GenerateOptions } from "./generate";
import {
  generatedTerrainPixels,
  generateMap,
  type RegenerateEnv,
  regenerateGalaxy,
} from "./mapStyle";
import type { GalaxyDoc } from "./model";
import { generatedTerrain } from "./territories";

/**
 * The slow parts of making a map, as jobs a worker can run. Building land
 * takes a few hundred milliseconds a go, which on the main thread stops the
 * page for that long and keeps any "working" notice from being drawn.
 * `landJobs.ts` is the way in. This module is what runs on the other side.
 */
export type LandJob =
  | { kind: "map"; opts: GenerateOptions }
  | { kind: "preview"; opts: GenerateOptions }
  | { kind: "regenerate"; galaxy: GalaxyDoc; env: RegenerateEnv; seed: number }
  | { kind: "pixels"; doc: GalaxyDoc };

/** The picture of a land map, RGBA row by row from the top left. */
export interface LandPicture {
  image: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A map for the setup form to show, and the picture of its land. */
export interface LandPreview {
  doc: GalaxyDoc;
  picture: LandPicture | null;
}

export interface LandJobResults {
  map: GalaxyDoc;
  preview: LandPreview;
  regenerate: GalaxyDoc | null;
  pixels: TerrainPixels | undefined;
}

export function runLandJob(job: LandJob): LandJobResults[LandJob["kind"]] {
  switch (job.kind) {
    case "map":
      return generateMap(job.opts);
    case "preview": {
      const doc = generateMap(job.opts);
      const terrain = generatedTerrain(doc);
      return {
        doc,
        picture: terrain && {
          image: terrain.image,
          width: terrain.width,
          height: terrain.height,
        },
      };
    }
    case "regenerate":
      return regenerateGalaxy(job.galaxy, job.env, job.seed);
    case "pixels":
      return generatedTerrainPixels(job.doc);
  }
}

/** Call `visit` for every typed array in a tree of plain objects and arrays. */
export function eachTypedArray(
  value: unknown,
  visit: (holder: object, key: string, array: ArrayBufferView) => void,
): void {
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (ArrayBuffer.isView(child)) visit(value, key, child);
    else eachTypedArray(child, visit);
  }
}
