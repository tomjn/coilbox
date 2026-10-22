/**
 * The footprint check (issue #3340): the footprint the export writes for the
 * unit as it is now, the footprint of its base alone, the footprint last
 * written, and how far the unit sticks out past the one in force.
 *
 * Sizes are in footprint steps, 16 elmos each: the engine's `SQUARE_SIZE` of 8
 * times `SPRING_FOOTPRINT_SCALE` of 2 (`rts/Sim/Misc/GlobalConstants.h`), which
 * is `ELMOS_PER_FOOTPRINT`. Positions are the bake's, in elmos. The footprint is
 * centred on the unit's origin, as the engine centres it on the unit's
 * position, and that is also where the viewport's plates sit.
 */

import { plural, t } from "@lingui/core/macro";
import { formatNumber } from "@/lib/format";
import { roleLabel } from "./animPresets";
import { SAME_POSITION } from "./balance";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { type Problem, problem } from "./problems";
import type { RawGeometry } from "./rawGeometry";
import { bakedPieces } from "./s3oBuild";
import { ELMOS_PER_FOOTPRINT, footprintSteps } from "./unitDef";

/**
 * The roles that usually point out past the body: a barrel, its flare, an aim
 * point, and a build arm's nozzle and nano points. The base footprint leaves
 * out a piece with one of these roles and everything under it. A long barrel
 * may still need ground, which is why the game maker can turn this off.
 */
export const OUTLYING_ROLES: readonly string[] = [
  "barrel",
  "flare",
  "aim",
  "buildarm.nozzle",
  "buildarm.nano",
];

/** A footprint in steps. */
export interface Footprint {
  x: number;
  z: number;
}

export interface WrittenFootprint extends Footprint {
  /** `export`: the definition last exported. `game`: a unit taken from a
   *  game, which carries that game's own number. */
  source: "export" | "game";
}

export type FootprintResult =
  | { status: "notApplicable"; reason: string }
  | {
      status: "ok";
      /** What the export would write now, from the whole box. */
      now: Footprint;
      /** The same with the outlying pieces left out, or equal to `now` when
       *  that is switched off or no piece has such a role. */
      base: Footprint;
      /** Ids of the pieces left out, each with geometry under it. */
      outlying: string[];
      /** The roles of those pieces, without repeats. */
      outlyingRoles: string[];
      /** The footprint in force, when there is one to compare with. */
      written: WrittenFootprint | null;
      /** Whether `written` is not what the export would write now. */
      differs: boolean;
      /** Elmos the whole unit's box passes the footprint in force, per axis,
       *  on whichever side passes further. Zero when inside. */
      overhang: { x: number; z: number };
      /** Steps `now` is bigger than `base`, per axis. */
      wasted: Footprint;
    };

interface Extent {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function extentOf(points: { x: number; z: number }[]): Extent | null {
  if (points.length === 0) return null;
  const extent = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (const p of points) {
    extent.minX = Math.min(extent.minX, p.x);
    extent.maxX = Math.max(extent.maxX, p.x);
    extent.minZ = Math.min(extent.minZ, p.z);
    extent.maxZ = Math.max(extent.maxZ, p.z);
  }
  return extent;
}

function stepsOf(extent: Extent | null): Footprint {
  return {
    x: footprintSteps(extent ? extent.maxX - extent.minX : 0),
    z: footprintSteps(extent ? extent.maxZ - extent.minZ : 0),
  };
}

function pastEdge(min: number, max: number, steps: number): number {
  const half = (steps * ELMOS_PER_FOOTPRINT) / 2;
  const over = Math.max(0, max - half, -half - min);
  return over > SAME_POSITION ? over : 0;
}

/** A number off a definition under any capitalisation of its key. */
function definitionNumber(
  def: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (!def) return null;
  const found = Object.entries(def).find(([k]) => k.toLowerCase() === key);
  return typeof found?.[1] === "number" && Number.isFinite(found[1])
    ? found[1]
    : null;
}

function writtenFootprint(project: LegoProject): WrittenFootprint | null {
  const candidates: [WrittenFootprint["source"], Record<string, unknown>?][] = [
    ["export", project.exported?.def],
    ["game", project.gameUnitDef],
  ];
  for (const [source, def] of candidates) {
    const x = definitionNumber(def, "footprintx");
    const z = definitionNumber(def, "footprintz");
    if (x !== null && z !== null) return { x, z, source };
  }
  return null;
}

/**
 * Measure the unit's footprint. `leaveOutOutlying` decides whether `base`
 * leaves out the pieces with an `OUTLYING_ROLES` role.
 *
 * The overhang is the whole unit, outlying pieces included, against the
 * footprint in force: the one last written if there is one, otherwise the one
 * the export would write now. A footprint written from the box's size alone
 * does not move with the box, so a unit that sits off its origin passes it
 * even when the sizes agree.
 */
export function checkFootprint(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  leaveOutOutlying: boolean,
): FootprintResult {
  const { world, ranges } = bakedPieces(project, pack, raw);
  if (world.length === 0) {
    return { status: "notApplicable", reason: t`The unit has no geometry.` };
  }

  const left = new Set<number>();
  const outlying: string[] = [];
  const roles = new Set<string>();
  if (leaveOutOutlying) {
    for (const piece of project.pieces) {
      if (!piece.role || !OUTLYING_ROLES.includes(piece.role)) continue;
      const range = ranges.get(piece.id);
      if (!range || range[0] === range[1]) continue;
      outlying.push(piece.id);
      roles.add(piece.role);
      for (let i = range[0]; i < range[1]; i++) left.add(i);
    }
  }

  const all = extentOf(world);
  const base = extentOf(world.filter((_, i) => !left.has(i)));
  const now = stepsOf(all);
  const baseSteps = stepsOf(base);
  const written = writtenFootprint(project);
  const inForce = written ?? now;

  return {
    status: "ok",
    now,
    base: baseSteps,
    outlying,
    outlyingRoles: [...roles],
    written,
    differs: written !== null && (written.x !== now.x || written.z !== now.z),
    overhang: all
      ? {
          x: pastEdge(all.minX, all.maxX, inForce.x),
          z: pastEdge(all.minZ, all.maxZ, inForce.z),
        }
      : { x: 0, z: 0 },
    wasted: { x: now.x - baseSteps.x, z: now.z - baseSteps.z },
  };
}

/** What the viewport says about a result, one line each. */
export function footprintLines(result: FootprintResult): string[] {
  if (result.status === "notApplicable") {
    return [t`Footprint not checked. The unit has no geometry.`];
  }
  const { now, base } = result;
  const nowX = now.x;
  const nowZ = now.z;
  const elmosX = now.x * ELMOS_PER_FOOTPRINT;
  const elmosZ = now.z * ELMOS_PER_FOOTPRINT;
  const lines = [
    t`Footprint ${nowX}x${nowZ} steps, ${elmosX} by ${elmosZ} elmos.`,
  ];
  if (result.outlying.length > 0) {
    const names = result.outlyingRoles
      .map((role) => roleLabel(role).toLowerCase())
      .join(", ");
    const baseX = base.x;
    const baseZ = base.z;
    lines.push(t`Without ${names}: ${baseX}x${baseZ}.`);
  }
  if (result.differs && result.written) {
    const writtenX = result.written.x;
    const writtenZ = result.written.z;
    lines.push(
      result.written.source === "game"
        ? t`The game has ${writtenX}x${writtenZ}, now ${nowX}x${nowZ}. The exported definition is not updated by a re-export.`
        : t`Exported ${writtenX}x${writtenZ}, now ${nowX}x${nowZ}. The exported definition is not updated by a re-export.`,
    );
  }
  const { wasted } = result;
  for (const axis of ["x", "z"] as const) {
    const steps = wasted[axis];
    if (steps > 0) {
      lines.push(
        plural(steps, {
          one: `Footprint is # step bigger than the base on ${axis}.`,
          other: `Footprint is # steps bigger than the base on ${axis}.`,
        }),
      );
    }
  }
  return lines;
}

/** The lines for the problems list: only a unit sticking out of its footprint. */
export function footprintProblems(result: FootprintResult): Problem[] {
  if (result.status !== "ok") return [];
  const { overhang, written, now } = result;
  const inForce = written ?? now;
  const forceX = inForce.x;
  const forceZ = inForce.z;
  return (["x", "z"] as const)
    .filter((axis) => overhang[axis] > 0)
    .map((axis) => {
      const by = formatNumber(overhang[axis], { maximumFractionDigits: 2 });
      return problem(
        "footprint",
        "warning",
        t`Sticks out of its ${forceX}x${forceZ} footprint by ${by} elmos on ${axis}.`,
      );
    });
}
