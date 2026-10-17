/**
 * What a built unit is worth, from the parts it is made of and a table the game
 * maker sets (issue #3280).
 *
 * The table gives a flat amount per unit, so a unit with no parts is not free,
 * and an amount per unit of volume. A part's volume is its bounding box times the
 * scale of its piece and of every piece above it, so a long beam is worth more
 * than a short one and moving a part changes nothing. A shape can replace the
 * per volume amount for the fields it names. Shape is the only kind a pack
 * states that tells parts apart: in the bundled pack `category` repeats
 * `colourway` and `material` is one value.
 *
 * The totals are what export writes as `maxdamage`, `buildcostmetal`,
 * `buildcostenergy`, `buildtime` and `mass`. Every game this was checked against
 * (Splinter Faction and Balanced Annihilation) spells them that way, and the
 * engine reads keys case blind.
 */

import type { LegoProject } from "./model";
import type { LegoPartInfo } from "./pack";
import { shapeBox } from "./shapes";

export const WORTH_FIELDS = [
  "health",
  "metal",
  "energy",
  "buildTime",
  "mass",
] as const;

export type WorthField = (typeof WORTH_FIELDS)[number];

export type WorthAmounts = Record<WorthField, number>;

export interface LegoWorth {
  /** What every unit is worth, parts or not. */
  base: WorthAmounts;
  /** What each unit of a part's volume adds. */
  perVolume: WorthAmounts;
  /** Per shape, the fields that replace `perVolume` for parts of that shape. */
  shapes?: Record<string, Partial<WorthAmounts>>;
}

/**
 * What a unit uses until the game maker sets a table. Placeholders that load:
 * the engine needs health and build time above zero. They say nothing about any
 * game's economy.
 */
export const PLACEHOLDER_WORTH: LegoWorth = {
  base: { health: 100, metal: 10, energy: 0, buildTime: 10, mass: 0 },
  perVolume: { health: 10, metal: 5, energy: 0, buildTime: 5, mass: 1 },
};

/** The totals for one unit, whole numbers. */
export type WorthTotals = WorthAmounts;

export function effectiveWorth(project: LegoProject): LegoWorth {
  return project.worth ?? PLACEHOLDER_WORTH;
}

/** The shapes of the parts a unit uses, in first seen order. */
export function usedShapes(
  project: LegoProject,
  pack: { byId: Map<string, LegoPartInfo> },
): string[] {
  const shapes = new Set<string>();
  for (const piece of project.pieces) {
    const sized = sizedAs(piece, pack);
    if (sized) shapes.add(sized.shape);
  }
  return [...shapes];
}

/**
 * What a piece is totalled as: its part's shape and box, or a generated shape's
 * kind and box (#3325). Null for a piece with neither.
 */
function sizedAs(
  piece: LegoProject["pieces"][number],
  pack: { byId: Map<string, LegoPartInfo> },
): Pick<LegoPartInfo, "shape" | "bbox"> | null {
  if (piece.shape) {
    const bbox = shapeBox(piece.shape);
    return bbox ? { shape: piece.shape.kind, bbox } : null;
  }
  return (piece.partId ? pack.byId.get(piece.partId) : undefined) ?? null;
}

function volumeOf(
  byId: Map<string, LegoProject["pieces"][number]>,
  pieceId: string,
  part: Pick<LegoPartInfo, "bbox">,
): number {
  const { min, max } = part.bbox;
  let volume =
    Math.abs(max[0] - min[0]) *
    Math.abs(max[1] - min[1]) *
    Math.abs(max[2] - min[2]);
  // A parent's scale carries into its children. The visited set stops a loop in
  // a damaged document from hanging the total.
  const seen = new Set<string>();
  let current = byId.get(pieceId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    volume *=
      Math.abs(current.scale[0]) *
      Math.abs(current.scale[1]) *
      Math.abs(current.scale[2]);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return volume;
}

/**
 * The unit's totals, or null for a unit imported whole from a model, which has
 * no parts to total and keeps the stand-in numbers.
 */
export function worthTotals(
  project: LegoProject,
  pack: { byId: Map<string, LegoPartInfo> },
): WorthTotals | null {
  if (project.imported) return null;
  const table = effectiveWorth(project);
  const byId = new Map(project.pieces.map((piece) => [piece.id, piece]));
  const sums: WorthAmounts = { ...table.base };
  for (const piece of project.pieces) {
    const info = sizedAs(piece, pack);
    if (!info) continue;
    const volume = volumeOf(byId, piece.id, info);
    const override = table.shapes?.[info.shape];
    for (const field of WORTH_FIELDS) {
      sums[field] += volume * (override?.[field] ?? table.perVolume[field]);
    }
  }
  return {
    health: Math.max(1, Math.round(sums.health)),
    metal: Math.max(0, Math.round(sums.metal)),
    energy: Math.max(0, Math.round(sums.energy)),
    buildTime: Math.max(1, Math.round(sums.buildTime)),
    mass: Math.max(0, Math.round(sums.mass)),
  };
}

function amount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseAmounts(value: unknown): WorthAmounts {
  const v = typeof value === "object" && value !== null ? value : {};
  const record = v as Record<string, unknown>;
  const out = {} as WorthAmounts;
  for (const field of WORTH_FIELDS) out[field] = amount(record[field]) ?? 0;
  return out;
}

function parsePartial(value: unknown): Partial<WorthAmounts> {
  const record = value as Record<string, unknown>;
  const out: Partial<WorthAmounts> = {};
  for (const field of WORTH_FIELDS) {
    const parsed = amount(record[field]);
    if (parsed !== null) out[field] = parsed;
  }
  return out;
}

/** A stored table, keeping only numbers the engine can take. */
export function parseWorth(value: unknown): LegoWorth | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.base !== "object" && typeof v.perVolume !== "object") {
    return null;
  }
  const shapes: Record<string, Partial<WorthAmounts>> = {};
  if (typeof v.shapes === "object" && v.shapes !== null) {
    for (const [shape, entry] of Object.entries(v.shapes)) {
      if (typeof entry !== "object" || entry === null) continue;
      const parsed = parsePartial(entry);
      if (Object.keys(parsed).length > 0) shapes[shape] = parsed;
    }
  }
  return {
    base: parseAmounts(v.base),
    perVolume: parseAmounts(v.perVolume),
    ...(Object.keys(shapes).length > 0 ? { shapes } : {}),
  };
}
