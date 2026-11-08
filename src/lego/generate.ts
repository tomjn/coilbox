/**
 * A unit from a seed, a body plan, a job and a size (issue #3231).
 *
 * The generator starts from the body plan's skeleton (`projectFromPlan`) and
 * hangs modules from the library on it: a chassis section on the plan's upper
 * body bone, and the job's weapon or build arm on top of the chassis. The
 * result is an ordinary unit, which the game maker then edits like any other.
 *
 * The same four inputs and the same module library always give the same
 * document. Every choice rolls its own PRNG, seeded off the inputs and the
 * choice's own key (`hashString`, `mulberry32` from `src/conquest/rng.ts`, the
 * pattern `src/workshop/randomMod.ts` follows), never off one stream that every
 * choice draws from in turn. Adding a choice later then leaves every other
 * choice as it was.
 *
 * The unit says in its notes which inputs made it, and keeps them in
 * `LegoProject.generated` with the module instance each slot produced, so a
 * reroll can tell the generator's pieces from ones somebody added (#3235).
 *
 * Nothing here needs a viewport, so a test generates a unit and compares the
 * document with a stored one.
 */

import { t } from "@lingui/core/macro";
import * as THREE from "three";
import { hashString, mulberry32, pick, randInt } from "../conquest/rng";
import { type BodyPlan, planProportions, projectFromPlan } from "./bodyPlans";
import { pieceConnectors, pieceOwnBox, resolveConnections } from "./connectors";
import { coverSkeleton, MAX_PART_SCALE } from "./covering";
import {
  DEFAULT_SPREAD,
  GENERATOR_JOBS,
  type GeneratorJob,
  type GeneratorJobDef,
  type GeneratorSize,
  type JobSlot,
  type Range,
} from "./generatorJobs";
import {
  countLean,
  type GeneratorStyle,
  girthLean,
  proportionLean,
  skewed,
} from "./generatorStyle";
import { withLimits } from "./jointLimits";
import {
  type LegoGenerated,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import { insertModule } from "./moduleMount";
import type { LoadedPack } from "./pack";
import { shapeColourways } from "./partOrder";
import { applyEuler } from "./portableRotation";
import { worldMatrix } from "./reparent";
import { addRunningGear } from "./runningGear";
import { defaultTarget, skeletonSize } from "./skeletonSize";
import { ELMOS_PER_FOOTPRINT } from "./unitDef";

export {
  GENERATOR_JOBS,
  type GeneratorJob,
  type GeneratorJobDef,
  type GeneratorSize,
  type JobSlot,
} from "./generatorJobs";

export interface GeneratorSizeDef {
  id: GeneratorSize;
  label: string;
}

/** What each size scales is in the job (`GeneratorJobData.size`). */
export const GENERATOR_SIZES: readonly GeneratorSizeDef[] = [
  {
    id: "small",
    get label() {
      return t`Small`;
    },
  },
  {
    id: "medium",
    get label() {
      return t`Medium`;
    },
  },
  {
    id: "large",
    get label() {
      return t`Large`;
    },
  },
];

/** The upper body bones a chassis goes on, best first, by bone id. A plan
 *  with none of them takes its root. */
const ANCHOR_BONES = ["torso", "deck", "body", "hull", "base"];

export interface GeneratorInputs {
  seed: number;
  plan: BodyPlan;
  job: GeneratorJob;
  size: GeneratorSize;
}

export interface GeneratorOptions {
  /** The unit's id, root piece id and date, as `newProject` takes them. */
  id: string;
  rootPieceId: string;
  now: string;
  pack: LoadedPack;
  /** The module library to choose from, such as `starterModules(pack)`. */
  modules: readonly LegoProject[];
  /** Ids for the pieces. Left off, they count up from the unit's id, so the
   *  document is the same on every run. */
  newId?: () => string;
  /** The skeleton's proportions as they are, rather than rolled. A reroll that
   *  keeps parts passes the unit's own, so the parts still fit (#3235). */
  proportions?: Record<string, number>;
  /** A look to bias the choices towards (#3237). It is not part of the rolls'
   *  keys, so the same seed with and without it makes a unit alike in the
   *  choices the style leaves alone. */
  style?: GeneratorStyle;
}

/** A PRNG for one choice, seeded off the inputs and the choice's key. */
function roll(inputs: GeneratorInputs, key: string): () => number {
  const { seed, plan, job, size } = inputs;
  return mulberry32(hashString(`${seed}|${plan.id}|${job}|${size}|${key}`));
}

/** `low` to `high`, from one roll. */
function between(rng: () => number, [low, high]: Range): number {
  return low + (high - low) * rng();
}

/**
 * Each proportion rolled. A length is its default times the job's size factor
 * times a roll in the job's range for it (`DEFAULT_SPREAD` when the job has
 * none), a count anywhere in its range. A proportion the job states against
 * another is then that one's rolled value times a roll in the job's range.
 * `planProportions` holds each to its range.
 */
function rollProportions(
  inputs: GeneratorInputs,
  job: GeneratorJobDef,
  factor: number,
  style: GeneratorStyle | undefined,
): Record<string, number> {
  const values: Record<string, number> = {};
  const rules = job.proportions.filter((rule) =>
    inputs.plan.proportions.some((p) => p.id === rule.id),
  );
  const rule = (id: string) =>
    rules.find((r) => r.id === id && r.against === undefined);
  for (const { id, unit, min, max, fallback } of inputs.plan.proportions) {
    const rng = skewed(
      roll(inputs, `proportion:${id}`),
      proportionLean(style, id),
    );
    values[id] =
      unit === "count"
        ? randInt(rng, min, max)
        : fallback * factor * between(rng, rule(id)?.range ?? DEFAULT_SPREAD);
  }
  for (const { id, against, range } of rules) {
    const base = against === undefined ? undefined : values[against];
    if (base !== undefined) {
      values[id] =
        base * between(roll(inputs, `proportion:${id}:against`), range);
    }
  }
  return planProportions(inputs.plan, values);
}

/** The unit's width and length in elmos: what its proportions measure, or
 *  the plan's default footprint times the size for an axis they do not set. */
function unitSize(
  plan: BodyPlan,
  proportions: Record<string, number>,
  factor: number,
): { x: number; z: number } {
  const measured = skeletonSize(plan, proportions);
  const { footprint } = defaultTarget(plan);
  return {
    x: measured.x ?? footprint.x * ELMOS_PER_FOOTPRINT * factor,
    z: measured.z ?? footprint.z * ELMOS_PER_FOOTPRINT * factor,
  };
}

/** The bone a chassis goes on. */
function anchorBone(project: LegoProject): LegoPiece {
  for (const bone of ANCHOR_BONES) {
    const piece = project.pieces.find((p) => p.bone === bone);
    if (piece) return piece;
  }
  return pieceById(project, project.rootPieceId) as LegoPiece;
}

/**
 * The library's modules a slot is filled from: those of its category carrying
 * all its tags, or all of the category when none does. In id order, so the
 * order the library lists them in cannot change a roll.
 */
function modulesFor(
  modules: readonly LegoProject[],
  slot: JobSlot,
): LegoProject[] {
  const inCategory = modules
    .filter((m) => m.category === slot.category)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const tagged = inCategory.filter((m) =>
    (slot.tags ?? []).every((tag) =>
      m.tags?.some((own) => own.toLowerCase() === tag.toLowerCase()),
    ),
  );
  return tagged.length > 0 ? tagged : inCategory;
}

/** A module's own width in elmos: its first piece's box across x. */
function moduleWidth(module: LegoProject, pack: LoadedPack): number | null {
  const root = pieceById(module, module.rootPieceId);
  const box = root && pieceOwnBox(pack, root);
  if (!root || !box) return null;
  // The factor worked out from this multiplies the scale the piece already has.
  const width = (box.max[0] - box.min[0]) * Math.abs(root.scale[0]);
  return width > 0 ? width : null;
}

/** Where a piece's connector is in the world. */
function connectorWorld(
  project: LegoProject,
  pack: LoadedPack,
  piece: LegoPiece,
  connectorId: string,
): THREE.Vector3 | null {
  const connector = pieceConnectors(pack, piece).find(
    (c) => c.id === connectorId,
  );
  if (!connector) return null;
  const pivot = piece.pivot ?? [0, 0, 0];
  return new THREE.Vector3(
    connector.position[0] - pivot[0],
    connector.position[1] - pivot[1],
    connector.position[2] - pivot[2],
  ).applyMatrix4(worldMatrix(project, piece.id));
}

/**
 * Every piece of one instance scaled by `factor`: its top piece and every
 * joined piece, since a joined piece leaves its parent's scale out. A top
 * piece that is not joined is then moved so its mount stays where it was.
 * The caller resolves the joins afterwards.
 */
function scaleInstance(
  project: LegoProject,
  pack: LoadedPack,
  instance: string,
  top: string,
  mount: { piece: string; connector: string } | null,
  factor: number,
): LegoProject {
  const mountPiece = mount ? pieceById(project, mount.piece) : undefined;
  const before =
    mount && mountPiece
      ? connectorWorld(project, pack, mountPiece, mount.connector)
      : null;
  let next: LegoProject = {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.module?.instance === instance &&
      (piece.id === top || piece.connection)
        ? {
            ...piece,
            scale: piece.scale.map((s) => s * factor) as LegoPiece["scale"],
          }
        : piece,
    ),
  };
  const topPiece = pieceById(next, top);
  const moved = mountPiece && pieceById(next, mountPiece.id);
  const after =
    mount && moved ? connectorWorld(next, pack, moved, mount.connector) : null;
  if (
    topPiece &&
    !topPiece.connection &&
    before &&
    after &&
    topPiece.parentId
  ) {
    const toParent = worldMatrix(next, topPiece.parentId).invert();
    const shift = before
      .clone()
      .applyMatrix4(toParent)
      .sub(after.clone().applyMatrix4(toParent));
    next = {
      ...next,
      pieces: next.pieces.map((piece) =>
        piece.id === top
          ? {
              ...piece,
              position: [
                piece.position[0] + shift.x,
                piece.position[1] + shift.y,
                piece.position[2] + shift.z,
              ],
            }
          : piece,
      ),
    };
  }
  return next;
}

/**
 * A piece lengthened by `factor` along its own y axis, with its near end where
 * it was: a barrel is a beam centred on its position, so the centre moves out
 * by half the added length.
 */
function stretchPiece(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  factor: number,
): LegoProject {
  const piece = pieceById(project, pieceId);
  if (!piece) return project;
  const box = pieceOwnBox(pack, piece);
  const half = box ? ((box.max[1] - box.min[1]) * piece.scale[1]) / 2 : 0;
  const along = applyEuler(
    new THREE.Vector3(0, 1, 0),
    piece.rotation,
  ).multiplyScalar((factor - 1) * half);
  return {
    ...project,
    pieces: project.pieces.map((p) =>
      p.id === pieceId
        ? {
            ...p,
            position: [
              p.position[0] + along.x,
              p.position[1] + along.y,
              p.position[2] + along.z,
            ],
            scale: [p.scale[0], p.scale[1] * factor, p.scale[2]],
          }
        : p,
    ),
  };
}

/**
 * The slot's rules for the pieces of one inserted module, by role: a barrel
 * stretched, or held to an elevation. Every piece with the role gets the same
 * roll, so a pair of barrels stays a pair. `rolls` makes a PRNG for a key.
 */
function applyRoleRules(
  project: LegoProject,
  pack: LoadedPack,
  instance: string,
  slot: JobSlot,
  rolls: (key: string) => () => number,
): LegoProject {
  let next = project;
  for (const [role, rule] of Object.entries(slot.roles ?? {})) {
    const ids = next.pieces
      .filter((p) => p.module?.instance === instance && p.role === role)
      .map((p) => p.id);
    const stretch =
      rule.stretch && between(rolls(`${role}:stretch`), rule.stretch);
    for (const id of ids) {
      if (stretch !== undefined) next = stretchPiece(next, pack, id, stretch);
      if (rule.pitch) {
        next = withLimits(next, id, {
          ...pieceById(next, id)?.limits,
          pitch: rule.pitch,
        });
      }
    }
  }
  return next;
}

/** The roles that make a piece part of a weapon. */
const GUN_ROLES: readonly string[] = ["turret", "aim", "barrel", "flare"];

/**
 * The plan's own gun joints made plain, for each gun role the module brings.
 *
 * A plan such as the ship's has a turret, barrel and flare of its own, but they
 * are bare joints with no part on them, and the chassis is built around them.
 * The module is the gun that can be seen. Left with their roles, the joints
 * would be a second gun, a second weapon in the export that nothing aims.
 * They stay as pieces rather than being deleted, because changing a proportion
 * adds back any bone the unit lacks (`applyProportions`).
 */
function yieldPlanGun(project: LegoProject, instance: string): LegoProject {
  const brought = new Set(
    project.pieces
      .filter((p) => p.module?.instance === instance && p.role)
      .map((p) => p.role),
  );
  const yielded = GUN_ROLES.filter((role) => brought.has(role));
  if (yielded.length === 0) return project;
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (piece.bone === undefined || !piece.role) return piece;
      if (!yielded.includes(piece.role)) return piece;
      const { role: _role, ...plain } = piece;
      return plain;
    }),
  };
}

/**
 * Every part piece of one instance in the style's colourway: the same shape in
 * that colourway, where the pack has one. The same shape has the same
 * connectors, so no join moves.
 */
function recolourInstance(
  project: LegoProject,
  pack: LoadedPack,
  instance: string,
  colourway: string,
): LegoProject {
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (piece.module?.instance !== instance || !piece.partId) return piece;
      const part = pack.byId.get(piece.partId);
      if (!part || part.colourway === colourway) return piece;
      const same = shapeColourways(pack, part).find(
        (p) => p.colourway === colourway,
      );
      return same ? { ...piece, partId: same.id } : piece;
    }),
  };
}

/** The inputs in words, for the unit's notes. */
export function describeInputs(inputs: GeneratorInputs): string {
  const seed = inputs.seed;
  const plan = inputs.plan.label;
  const job =
    GENERATOR_JOBS.find((j) => j.id === inputs.job)?.label ?? inputs.job;
  const size =
    GENERATOR_SIZES.find((s) => s.id === inputs.size)?.label ?? inputs.size;
  return t`Generated from seed ${seed}, body plan ${plan}, job ${job}, size ${size}.`;
}

/** Throws for a job or size this version does not know, which is a caller's
 *  mistake rather than something a game maker can type. */
export function generateUnit(
  inputs: GeneratorInputs,
  options: GeneratorOptions,
): LegoProject {
  const job = GENERATOR_JOBS.find((j) => j.id === inputs.job);
  const size = GENERATOR_SIZES.find((s) => s.id === inputs.size);
  if (!job) throw new Error(`no generator job ${inputs.job}`);
  if (!size || !(size.id in job.size))
    throw new Error(`no generator size ${inputs.size}`);
  // A saved unit keeps only a whole seed (`parseGenerated`), so any other
  // could not be remade.
  if (!Number.isSafeInteger(inputs.seed)) {
    throw new Error(`a generator seed is a whole number, not ${inputs.seed}`);
  }
  const { pack } = options;
  let counter = 0;
  const newId = options.newId ?? (() => `${options.id}.${++counter}`);

  const factor = job.size[size.id];
  const proportions = options.proportions
    ? planProportions(inputs.plan, options.proportions)
    : rollProportions(inputs, job, factor, options.style);
  const jobLabel = job.label;
  const planLabel = inputs.plan.label;
  const seed = inputs.seed;
  const name = t`${jobLabel} ${planLabel} ${seed}`;
  let project = projectFromPlan(inputs.plan, {
    id: options.id,
    rootPieceId: options.rootPieceId,
    name,
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    now: options.now,
    newId,
    proportions,
  });

  const generated: LegoGenerated["modules"] = [];
  const { style } = options;
  const bulk = between(
    skewed(roll(inputs, "bulk"), girthLean(style)),
    job.bulk,
  );
  const extent = unitSize(inputs.plan, proportions, factor);
  const width = extent.x;
  const keepClear = new Set<string>();
  let scale = 1;
  let chassisTop: string | null = null;

  for (const [index, slot] of job.slots.entries()) {
    const candidates = modulesFor(options.modules, slot);
    if (candidates.length === 0) continue;
    const count = randInt(
      skewed(roll(inputs, `slot:${slot.id}:count`), countLean(style)),
      ...slot.count,
    );
    for (let n = 1; n <= count; n++) {
      const module = pick(
        roll(inputs, `slot:${slot.id}:${n}:module`),
        candidates,
      );
      const isChassis = index === 0;
      const parent =
        isChassis || chassisTop === null ? anchorBone(project).id : chassisTop;
      const placement =
        !isChassis && chassisTop !== null
          ? { to: "+y", cycle: 0, twist: 0 }
          : undefined;
      const placed = insertModule(
        project,
        module,
        parent,
        newId,
        pack,
        placement,
        true,
      );
      const top = placed.rootPieceIds[0];
      const instance = top && pieceById(placed.project, top)?.module?.instance;
      if (!top || !instance) continue;
      const inserted = style?.colourway
        ? {
            ...placed,
            project: recolourInstance(
              placed.project,
              pack,
              instance,
              style.colourway,
            ),
          }
        : placed;
      if (isChassis) {
        const own = moduleWidth(module, pack);
        // Bounded, so a big unit's chassis is not one part blown up: the
        // covering fills out the rest of its body. The bulk applies after the
        // bound, so two seeds of a big unit still differ.
        scale = own ? Math.min(width / own, MAX_PART_SCALE) * bulk : 1;
        chassisTop = top;
      }
      const slotScale = isChassis
        ? 1
        : between(
            roll(inputs, `slot:${slot.id}:${n}:scale`),
            slot.scale ?? [1, 1],
          );
      const mountId = module.mount && inserted.idMap.get(module.mount.piece);
      project = scaleInstance(
        inserted.project,
        pack,
        instance,
        top,
        mountId && module.mount
          ? { piece: mountId, connector: module.mount.connector }
          : null,
        Math.min(scale * slotScale, MAX_PART_SCALE),
      );
      // Before the joins are resolved, so a joined piece that is stretched is
      // put where its join says.
      project = applyRoleRules(project, pack, instance, slot, (key) =>
        roll(inputs, `slot:${slot.id}:${n}:${key}`),
      );
      project = resolveConnections(project, pack).project;
      project = yieldPlanGun(project, instance);
      if (!isChassis) keepClear.add(instance);
      generated.push({ slot: `${slot.id}.${n}`, module: module.id, instance });
    }
  }

  const running = addRunningGear(project, {
    pack,
    chassis: chassisTop,
    newId,
    roll: (key) => roll(inputs, key),
  });
  project = running.project;

  const covered = coverSkeleton(project, {
    pack,
    rule: job.covering,
    anchor: anchorBone(project),
    chassis: chassisTop,
    keepClear,
    gear: new Set(running.gear.map((g) => g.piece)),
    size: extent,
    width,
    newId,
    roll: (key) => roll(inputs, key),
    style,
  });
  project = resolveConnections(covered.project, pack).project;

  return {
    ...project,
    notes: describeInputs(inputs),
    generated: {
      seed: inputs.seed,
      plan: inputs.plan.id,
      job: inputs.job,
      size: inputs.size,
      modules: generated,
      covering: covered.covering,
      ...(running.gear.length > 0 ? { running: running.gear } : {}),
      ...(style ? { style } : {}),
    },
  };
}
