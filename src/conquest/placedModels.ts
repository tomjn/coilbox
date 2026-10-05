/**
 * Models an author stands on a terrain map: trees to mark a forest, a building
 * to mark a city. They are scenery. A placed model is not a location, cannot
 * be selected and has no effect on the rules.
 *
 * Kept apart from `model.ts` so the type and its validation sit together.
 * Drawing them is `galaxy3d/placedModelsLayer.ts`.
 */

/**
 * Which model to draw. The two kinds are tagged so one cannot be read as the
 * other:
 *
 * - `game`: a model the game ships. The name is tried in this order, and the
 *   first that gives a model wins:
 *   1. a whole path inside the game archive, such as
 *      `"objects3d/features/pinetree.s3o"`
 *   2. a model file name with or without its extension, the way a unit's
 *      `objectname` or a feature's `object` writes it, such as `"armcom"` or
 *      `"features/pinetree.s3o"`
 *   3. a unit name, drawing the model the unit's `objectname` names
 *   4. a feature name the game defines under `features/`, drawing the model
 *      the feature's `object` names
 *   Unit and feature names match whatever their case. A name that matches a
 *   model file and also a unit or feature draws the model file.
 * - `file`: a `.gltf` or `.glb` file in the map's own folder, as a path
 *   relative to that folder.
 */
export type ModelRef = { game: string } | { file: string };

/** One model placed on a terrain map. */
export interface PlacedModel {
  model: ModelRef;
  /** Where it stands, in map units: origin top left, x right, y down. */
  pos: [number, number];
  /**
   * Height of the model's origin in map units above zero. Absent means the
   * ground at `pos`.
   */
  height?: number;
  /**
   * Turn about the vertical axis in degrees. 0 leaves the model as its file
   * has it. A positive angle turns it anticlockwise seen from above, so 90
   * turns a model that faced the bottom of the map picture to face its right.
   */
  rotation?: number;
  /**
   * Size multiplier. At 1, the default, one unit of the model is one map
   * unit.
   */
  scale?: number;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** File endings a `file` reference may have. */
export const MODEL_FILE_EXTS = [".gltf", ".glb"];

/**
 * A `file` reference stays inside the map folder: a relative path with
 * forward slashes, no `..` step and no drive or scheme.
 */
function isMapFolderFile(name: string): boolean {
  if (name.startsWith("/") || name.includes("\\") || name.includes(":")) {
    return false;
  }
  if (name.split("/").some((step) => step === "" || step === "..")) {
    return false;
  }
  const lower = name.toLowerCase();
  return MODEL_FILE_EXTS.some((ext) => lower.endsWith(ext));
}

function parseModelRef(value: unknown): ModelRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  const hasGame = r.game !== undefined;
  const hasFile = r.file !== undefined;
  // Exactly one tag, so a reference is never both kinds at once.
  if (hasGame === hasFile) return undefined;
  if (hasGame) {
    return typeof r.game === "string" && r.game.trim() !== ""
      ? { game: r.game.trim() }
      : undefined;
  }
  return typeof r.file === "string" && isMapFolderFile(r.file)
    ? { file: r.file }
    : undefined;
}

/**
 * Read a document's `models` list. An entry without a usable model reference
 * or position is dropped, a malformed optional field is dropped from its
 * entry, and an empty list reads as absent.
 */
export function parsePlacedModels(value: unknown): PlacedModel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: PlacedModel[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const e = raw as Record<string, unknown>;
    const model = parseModelRef(e.model);
    const pos = e.pos;
    if (!model || !Array.isArray(pos) || !finite(pos[0]) || !finite(pos[1])) {
      continue;
    }
    const entry: PlacedModel = { model, pos: [pos[0], pos[1]] };
    if (finite(e.height)) entry.height = e.height;
    if (finite(e.rotation)) entry.rotation = e.rotation;
    if (finite(e.scale) && e.scale > 0) entry.scale = e.scale;
    out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}
