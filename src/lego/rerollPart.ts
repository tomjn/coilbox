/**
 * Rerolling one part of a unit open in the builder (issue #3236).
 *
 * Works on any unit, generated or not. With a piece selected:
 * - A piece in a module is rerolled as that module, since a module rerolls
 *   whole. The replacement is another module of the same category (`category`
 *   on the module), put where the old one was by `swapModule`.
 * - A plain pack part is rerolled to another part of the same kind: the same
 *   `shape` and `category`, the same `colourway`, and the same size tags the
 *   pack gives it, so a small grey block stays a small grey block. When no
 *   other part has the same size tags the size is dropped from the match.
 *   `shapeVariants` would only offer other colourways of the same shape. The
 *   swap is `swapPart`.
 * - Anything else (a generated shape, an imported mesh, an empty piece) has no
 *   kind to match, so there is nothing to reroll.
 *
 * Either way the piece keeps its place, children, role and joins by the rules
 * of those two swaps, and a candidate that leaves a join unable to be made is
 * skipped. A module also keeps its size: the scale the old module had over its
 * own document is put on the new one.
 *
 * The choice is made from a seed. A reroll tries the seed after the piece's
 * last (`LegoPiece.rerolled`, else the unit's generated seed, else 0), and moves
 * on a seed at a time past a pick that is the part already there or does not
 * fit. The seed that made the result is recorded on the piece (the top piece of
 * a module), so rerolling from that seed again on the unit as it was gives the
 * same part. The ids of a module's new pieces are the only thing that differs.
 *
 * On a generated unit the rerolled module or part counts as edited by hand,
 * which is what keeps it through a reroll of the whole unit (#3235).
 */

import { t } from "@lingui/core/macro";
import { hashString, mulberry32, pick } from "../conquest/rng";
import type { PresetOutcome } from "./compounds";
import { resolveConnections } from "./connectors";
import { MAX_PART_SCALE } from "./covering";
import { applyRoleRules } from "./generate";
import { GENERATOR_TRIES, nextSeed } from "./generateChecked";
import { GENERATOR_JOBS } from "./generatorJobs";
import { holdsMeshes, liftedModuleRefusal } from "./liftPiece";
import {
  type LegoGenerated,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import { sameCategory } from "./moduleFilter";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { partTitle, visibleTags } from "./partOrder";
import { swapModule } from "./swapModule";
import { swapPart } from "./swapPart";

export type RerollKind = "module" | "part";

export interface RerollPartOptions {
  /** The module library to choose from. */
  modules: readonly LegoProject[];
  /** The seed to try first. Left off, the one after the piece's last. */
  seed?: number;
  /** How many seeds to try. Defaults to what a new unit tries. */
  tries?: number;
  /** Ids for a module's new pieces. Defaults to random ones. */
  newId?: () => string;
  /** Swap a mirror twin or ring with the module, as the builder's switch. */
  symmetry?: boolean;
}

export type RerollPartResult =
  | {
      status: "ok";
      project: LegoProject;
      kind: RerollKind;
      /** The seed that made it, which the piece also records. */
      seed: number;
      /** The name of what the piece was and of what it is now. */
      from: string;
      to: string;
      /** The pieces to select afterwards. */
      select: string[];
      /** Names of kept pieces that found no piece with their parent's role. */
      moved: string[];
      removedPresets: string[];
      presets?: PresetOutcome;
      /** Names of the anchors that fell outside the new part. */
      droppedAnchors: string[];
    }
  | { status: "failed"; message: string };

/** What a reroll of this piece would change, or null when it has no kind. */
export function rerollKind(
  project: LegoProject,
  pieceId: string,
): RerollKind | null {
  const piece = pieceById(project, pieceId);
  if (!piece) return null;
  if (piece.module) {
    // Imported meshes have no kind to match, and a module holding one is made
    // of them.
    const instance = piece.module.instance;
    return project.pieces.some(
      (p) => p.module?.instance === instance && p.meshId,
    )
      ? null
      : "module";
  }
  return piece.partId && !piece.meshId ? "part" : null;
}

/** The highest piece above `pieceId` in the same module instance. */
function moduleTop(project: LegoProject, pieceId: string) {
  const instance = pieceById(project, pieceId)?.module?.instance;
  if (instance === undefined) return undefined;
  let top = pieceById(project, pieceId);
  for (;;) {
    const parent = top?.parentId ? pieceById(project, top.parentId) : undefined;
    if (!parent || parent.module?.instance !== instance) return top;
    top = parent;
  }
}

/** The seed of the last reroll of the part or module `pieceId` is in. */
export function rerolledSeed(
  project: LegoProject,
  pieceId: string,
): number | undefined {
  const piece = pieceById(project, pieceId);
  const holder = piece?.module ? moduleTop(project, pieceId) : piece;
  return holder?.rerolled?.seed;
}

function byId<T extends { id: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A part's size tags: what it is tagged with besides its shape and the atlas
 *  row. The bundled pack tags each tiny, small, medium, large or huge. */
function sizeTags(part: LegoPartInfo): string {
  return visibleTags(part.tags)
    .filter((tag) => tag !== part.shape)
    .sort()
    .join("|");
}

/**
 * The other parts of the same kind as `part`, in id order: the same shape,
 * category and colourway, and the same size tags when any other part has them.
 */
export function partFamily(pack: LoadedPack, part: LegoPartInfo) {
  const alike = pack.parts.filter(
    (other) =>
      other.id !== part.id &&
      other.shape === part.shape &&
      other.category === part.category &&
      other.colourway === part.colourway,
  );
  const size = alike.filter((other) => sizeTags(other) === sizeTags(part));
  return byId(size.length > 0 ? size : alike);
}

/** The modules other than `current` with its category, in id order, that a
 *  reroll can put in: none that hold lifted game pieces or meshes. */
export function moduleFamily(
  project: LegoProject,
  modules: readonly LegoProject[],
  current: LegoProject,
): LegoProject[] {
  const category = current.category;
  if (!category) return [];
  return byId(
    modules.filter(
      (module) =>
        module.id !== current.id &&
        !!module.category &&
        sameCategory(module.category, category) &&
        !holdsMeshes(module) &&
        !liftedModuleRefusal(project, module),
    ),
  );
}

function failed(message: string): RerollPartResult {
  return { status: "failed", message };
}

/** A PRNG for one choice of a seed. */
function rolls(seed: number, key: string): () => number {
  return mulberry32(hashString(`${seed}|reroll|${key}`));
}

/**
 * The project with the part or module `pieceId` is in rerolled, or why not.
 * `project` itself is left as it is, so a caller makes it one edit for undo.
 */
export function rerollPart(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  options: RerollPartOptions,
): RerollPartResult {
  const kind = rerollKind(project, pieceId);
  if (!kind) {
    return failed(
      t`This piece is not a part or module, so it cannot be rerolled.`,
    );
  }
  const tries = options.tries ?? GENERATOR_TRIES;
  const seeds: number[] = [];
  let seed =
    options.seed ??
    nextSeed(rerolledSeed(project, pieceId) ?? project.generated?.seed ?? 0);
  for (let n = 0; n < tries; n++) {
    seeds.push(seed);
    seed = nextSeed(seed);
  }
  return kind === "module"
    ? rerollModule(project, pack, pieceId, options, seeds)
    : rerollPlain(project, pack, pieceId, seeds);
}

function rerollPlain(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  seeds: number[],
): RerollPartResult {
  const piece = pieceById(project, pieceId) as LegoPiece;
  const current = pack.byId.get(piece.partId as string);
  if (!current) {
    return failed(t`This piece's part is not in the parts library.`);
  }
  const family = partFamily(pack, current);
  if (family.length === 0) {
    return failed(t`No other part has this part's shape and colour.`);
  }
  // The current part is in the draw, so a seed means the same part whatever
  // the piece is now. A seed that draws it changes nothing and is passed over.
  const draw = byId([...family, current]);
  for (const seed of seeds) {
    const part = pick(rolls(seed, "part"), draw);
    if (part.id === current.id) continue;
    const swapped = swapPart(project, pack, pieceId, part.id);
    if (!swapped || swapped.broken.length > 0) continue;
    return {
      status: "ok",
      project: {
        ...swapped.project,
        pieces: swapped.project.pieces.map((p) =>
          p.id === pieceId ? { ...p, rerolled: { seed } } : p,
        ),
      },
      kind: "part",
      seed,
      from: partTitle(pack, current),
      to: partTitle(pack, part),
      select: [pieceId],
      moved: [],
      removedPresets: [],
      droppedAnchors: swapped.droppedAnchors,
    };
  }
  const first = seeds[0];
  const last = seeds[seeds.length - 1];
  return failed(
    t`No seed from ${first} to ${last} found another part that fits. Try again or change it by hand.`,
  );
}

/** What a module reroll works from, or why it cannot go ahead. */
function moduleSetup(
  project: LegoProject,
  pieceId: string,
  modules: readonly LegoProject[],
) {
  const top = moduleTop(project, pieceId) as LegoPiece;
  const ref = top.module as NonNullable<LegoPiece["module"]>;
  const current = modules.find((m) => m.id === ref.id);
  if (!current) {
    return {
      ok: false as const,
      message: t`This module is not in the module library.`,
    };
  }
  if (!current.category) {
    return {
      ok: false as const,
      message: t`This module has no category, so there is no other of its kind.`,
    };
  }
  const generated = project.generated;
  const slotName = generated?.modules.find(
    (m) => m.instance === ref.instance,
  )?.slot;
  const job = GENERATOR_JOBS.find((j) => j.id === generated?.job);
  const slot = job?.slots.find((s) => s.id === slotName?.split(".")[0]);
  // The chassis fixes the unit's scale and the other slots roll theirs against
  // it, as the generator does, so only those can be rolled again.
  const chassisSize =
    slot?.scale && slot !== job?.slots[0]
      ? moduleSize(project, modules, job?.slots[0]?.id)
      : undefined;
  const rollable =
    chassisSize !== undefined || Object.keys(slot?.roles ?? {}).length > 0;
  const family = moduleFamily(project, modules, current);
  // With nothing else of its category, a generated module is rolled again, as
  // far as its slot's rules for its size and its pieces go. That is all a
  // reroll can change.
  if (family.length === 0 && !rollable) {
    const category = current.category;
    return {
      ok: false as const,
      message: t`No other module is in the ${category} category.`,
    };
  }
  return { ok: true as const, top, ref, current, slot, chassisSize, family };
}

/**
 * Why `pieceId` cannot be rerolled, or null when it can: it has no kind, or
 * nothing else is of its kind. Whether a seed finds one that fits is not told.
 */
export function rerollRefusal(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  modules: readonly LegoProject[],
): string | null {
  const kind = rerollKind(project, pieceId);
  if (kind === "module") {
    const setup = moduleSetup(project, pieceId, modules);
    return setup.ok ? null : setup.message;
  }
  if (kind === "part") {
    const piece = pieceById(project, pieceId) as LegoPiece;
    const current = pack.byId.get(piece.partId as string);
    if (!current) return t`This piece's part is not in the parts library.`;
    return partFamily(pack, current).length === 0
      ? t`No other part has this part's shape and colour.`
      : null;
  }
  return t`This piece is not a part or module, so it cannot be rerolled.`;
}

function rerollModule(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  options: RerollPartOptions,
  seeds: number[],
): RerollPartResult {
  const setup = moduleSetup(project, pieceId, options.modules);
  if (!setup.ok) return failed(setup.message);
  const { top, ref, current, slot, chassisSize, family } = setup;
  const draw = byId(family.length > 0 ? [...family, current] : [current]);
  const rootScale = Math.abs(
    pieceById(current, current.rootPieceId)?.scale[0] ?? 1,
  );
  const kept = rootScale > 0 ? Math.abs(top.scale[0]) / rootScale : 1;
  const before = new Set(resolveConnections(project, pack).broken);
  const oldInstances = new Set(project.pieces.map((p) => p.module?.instance));
  const newId = options.newId ?? (() => crypto.randomUUID());

  for (const seed of seeds) {
    const module = pick(rolls(seed, "module"), draw);
    if (module.id === current.id && family.length > 0) continue;
    const [low, high] = slot?.scale ?? [1, 1];
    const size =
      chassisSize === undefined
        ? kept
        : Math.min(
            chassisSize * (low + (high - low) * rolls(seed, "scale")()),
            MAX_PART_SCALE,
          );
    const swapped = swapModule(project, pack, pieceId, module, newId, {
      symmetry: options.symmetry,
    });
    if (!swapped) continue;
    let next = swapped.project;
    const fresh = new Set(
      next.pieces.flatMap((p) =>
        p.module && !oldInstances.has(p.module.instance)
          ? [p.module.instance]
          : [],
      ),
    );
    next = {
      ...next,
      pieces: next.pieces.map((p) => {
        if (!p.module || !fresh.has(p.module.instance)) return p;
        // The generator scales a module's joined pieces and nothing else. A top
        // that is not joined took the old top's scale already.
        return p.connection && size !== 1
          ? {
              ...p,
              scale: p.scale.map((s) => s * size) as LegoPiece["scale"],
            }
          : p;
      }),
    };
    const root = swapped.rootPieceIds[0];
    // A module that was joined stays joined. `swapModule` falls back to the old
    // place when the new one cannot form the join, which is not a reroll that
    // keeps its connections.
    if (top.connection && !pieceById(next, root)?.connection) continue;
    const instance = pieceById(next, root)?.module?.instance;
    if (slot && instance !== undefined) {
      next = applyRoleRules(next, pack, instance, slot, (key) =>
        rolls(seed, key),
      );
    }
    next = resolveConnections(next, pack).project;
    const after = resolveConnections(next, pack).broken;
    if (after.some((id) => !before.has(id))) continue;

    const stamped: LegoProject = {
      ...next,
      pieces: next.pieces.map((p) =>
        swapped.rootPieceIds.includes(p.id) ? { ...p, rerolled: { seed } } : p,
      ),
    };
    return {
      status: "ok",
      project: recorded(stamped, project, ref.instance, module, instance),
      kind: "module",
      seed,
      from: current.name,
      to: module.name,
      select: swapped.rootPieceIds,
      moved: swapped.moved,
      removedPresets: swapped.removedPresets,
      presets: swapped.presets,
      droppedAnchors: [],
    };
  }
  const first = seeds[0];
  const last = seeds[seeds.length - 1];
  return failed(
    t`No seed from ${first} to ${last} found another module that fits. Try again or change it by hand.`,
  );
}

/** How far the module in the first slot of the job, the chassis, is scaled over
 *  its own document, or undefined when the unit has none or it is not found. */
function moduleSize(
  project: LegoProject,
  modules: readonly LegoProject[],
  slotId: string | undefined,
): number | undefined {
  const entry = project.generated?.modules.find((m) =>
    m.slot.startsWith(`${slotId}.`),
  );
  const pieces = project.pieces.filter(
    (p) => p.module?.instance === entry?.instance,
  );
  const top = pieces.find((p) => !pieces.some((q) => q.id === p.parentId));
  const module = modules.find((m) => m.id === entry?.module);
  const root = module && pieceById(module, module.rootPieceId);
  if (!top || !root || root.scale[0] === 0) return undefined;
  return Math.abs(top.scale[0]) / Math.abs(root.scale[0]);
}

/** The generated record naming the new module in the slot the old one filled,
 *  and without the stamps of pieces that are gone. */
function recorded(
  unit: LegoProject,
  old: LegoProject,
  oldInstance: string,
  module: LegoProject,
  instance: string | undefined,
): LegoProject {
  const generated = unit.generated;
  if (!generated || instance === undefined) return unit;
  const present = new Set(unit.pieces.map((p) => p.id));
  const stamps = generated.stamps
    ? Object.fromEntries(
        Object.entries(generated.stamps).filter(
          ([id]) => present.has(id) || !old.pieces.some((p) => p.id === id),
        ),
      )
    : undefined;
  const next: LegoGenerated = {
    ...generated,
    modules: generated.modules.map((m) =>
      m.instance === oldInstance ? { ...m, module: module.id, instance } : m,
    ),
    ...(stamps ? { stamps } : {}),
  };
  return { ...unit, generated: next };
}
