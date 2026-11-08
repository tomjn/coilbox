/**
 * Rerolling a generated unit while keeping the parts the game maker wants
 * (issue #3235).
 *
 * A part is what the generator made as one thing: a module instance, a
 * covering part, a wheel or tread, or a bone. A reroll generates the unit again
 * from the seed after the one it records, and swaps in each kept part from the
 * unit as it was, on the same bone or in the same slot, with its joins. The
 * merged unit then goes through the same repairs and checks as a new one
 * (`generateChecked.ts`), moving on a seed at a time.
 *
 * A piece is kept when it is locked (`LegoPiece.locked`), or when it was edited
 * by hand and not freed with `locked: false`. Hand edits are told by the stamps
 * a checked unit records (`generatedStamps.ts`). Keeping a piece keeps:
 * - every piece of its module instance, because a module rerolls whole
 * - the rest of its bone's covering, or its bone's wheels or treads, which
 *   were fitted to the bone as a set
 * - what it hangs on, short of a bone, so it stays joined to the same thing
 * - for a bone, the covering and wheels on it, which were sized to it.
 * While anything is kept the skeleton keeps its proportions, so the parts the
 * reroll makes are sized for the same frame as the ones it keeps. A part the
 * game maker deleted stays deleted.
 *
 * The result records the seed that made it. The same unit rerolled from the
 * same seed gives the same result.
 */

import { t } from "@lingui/core/macro";
import { bodyPlanById, planProportions } from "./bodyPlans";
import { resolveConnections } from "./connectors";
import {
  GENERATOR_JOBS,
  type GeneratorJob,
  type GeneratorSize,
  generateUnit,
} from "./generate";
import {
  GENERATOR_TRIES,
  generatorFaults,
  nextSeed,
  repairCandidate,
} from "./generateChecked";
import { pieceStamp, withStamps } from "./generatedStamps";
import { withoutDanglingTwins } from "./mirror";
import type { LegoGenerated, LegoPiece, LegoProject } from "./model";
import type { LoadedPack } from "./pack";

export interface RerollOptions {
  pack: LoadedPack;
  /** The module library, the same the unit was generated from. */
  modules: readonly LegoProject[];
  tries?: number;
}

export type RerollResult =
  | {
      status: "ok";
      unit: LegoProject;
      /** The seed that made it, which the unit also records. */
      seed: number;
      tries: number;
    }
  | { status: "failed"; message: string };

/**
 * The pieces edited by hand since the unit was generated, added ones included.
 * A unit generated before stamps counts as edited only the pieces its record
 * does not name.
 */
export function editedPieces(project: LegoProject): Set<string> {
  const generated = project.generated;
  const out = new Set<string>();
  if (!generated) return out;
  const { stamps } = generated;
  if (stamps) {
    for (const piece of project.pieces) {
      if (stamps[piece.id] !== pieceStamp(piece)) out.add(piece.id);
    }
    return out;
  }
  const instances = new Set(generated.modules.map((m) => m.instance));
  const listed = new Set(
    [...(generated.covering ?? []), ...(generated.running ?? [])].map(
      (entry) => entry.piece,
    ),
  );
  for (const piece of project.pieces) {
    const made =
      piece.bone !== undefined ||
      listed.has(piece.id) ||
      (piece.module !== undefined && instances.has(piece.module.instance));
    if (!made) out.add(piece.id);
  }
  return out;
}

/**
 * The generator's parts on bones, by piece id: the covering of one bone is one
 * part, and so are the wheels or treads of one bone, because each was fitted
 * to the bone as a set. Pieces listed but deleted are included.
 */
function boneParts(generated: LegoGenerated): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of generated.covering ?? []) out.set(c.piece, `c|${c.bone}`);
  for (const r of generated.running ?? [])
    out.set(r.piece, `r|${r.bone}|${r.kind}`);
  return out;
}

/** The pieces locked or kept with `pieceId`: its whole module instance, the
 *  covering or running gear of its bone, or the piece alone. What the lock
 *  toggle acts on. */
export function partPieces(project: LegoProject, pieceId: string): string[] {
  const piece = project.pieces.find((p) => p.id === pieceId);
  if (!piece) return [];
  const instance = piece.module?.instance;
  if (instance) {
    return project.pieces
      .filter((p) => p.module?.instance === instance)
      .map((p) => p.id);
  }
  const parts = project.generated ? boneParts(project.generated) : new Map();
  const part = parts.get(piece.id);
  if (part === undefined) return [piece.id];
  return project.pieces
    .filter((p) => parts.get(p.id) === part)
    .map((p) => p.id);
}

/** Whether a piece is kept by its own flag or its edit, before the rules that
 *  keep its neighbours. */
export function keptByItself(piece: LegoPiece, edited: Set<string>): boolean {
  return (
    piece.locked === true || (piece.locked !== false && edited.has(piece.id))
  );
}

/** Lock or free the part `pieceId` is in. Freeing a part that was not edited
 *  clears its flag, since that is what no flag means for it. */
export function setPartLocked(
  project: LegoProject,
  pieceId: string,
  locked: boolean,
): LegoProject {
  const ids = new Set(partPieces(project, pieceId));
  if (ids.size === 0) return project;
  const edited = editedPieces(project);
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (!ids.has(piece.id)) return piece;
      const { locked: _was, ...rest } = piece;
      const byDefault = edited.has(piece.id);
      return locked === byDefault ? rest : { ...rest, locked };
    }),
  };
}

/** Every piece a reroll keeps, by the rules at the top of this file. `edited`
 *  is `editedPieces(project)`, when the caller has it already. */
export function keptPieces(
  project: LegoProject,
  edited: Set<string> = editedPieces(project),
): Set<string> {
  const generated = project.generated;
  const kept = new Set<string>();
  if (!generated) return kept;
  const byId = new Map(project.pieces.map((p) => [p.id, p]));
  const byInstance = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const piece of project.pieces) {
    if (piece.module) {
      const list = byInstance.get(piece.module.instance) ?? [];
      list.push(piece.id);
      byInstance.set(piece.module.instance, list);
    }
    if (piece.parentId) {
      const list = children.get(piece.parentId) ?? [];
      list.push(piece.id);
      children.set(piece.parentId, list);
    }
  }
  const parts = boneParts(generated);
  const byPart = new Map<string, string[]>();
  for (const piece of project.pieces) {
    const part = parts.get(piece.id);
    if (part === undefined) continue;
    const list = byPart.get(part) ?? [];
    list.push(piece.id);
    byPart.set(part, list);
  }

  const queue: string[] = [];
  const keep = (id: string) => {
    if (kept.has(id) || !byId.has(id)) return;
    kept.add(id);
    queue.push(id);
  };
  for (const piece of project.pieces) {
    if (keptByItself(piece, edited)) keep(piece.id);
  }
  // A module piece deleted by hand leaves its instance edited.
  for (const instance of deletedInstances(project)) {
    for (const id of byInstance.get(instance) ?? []) keep(id);
  }
  // So does deleting some of a bone's covering or running gear.
  for (const [id, part] of parts) {
    if (!byId.has(id)) for (const other of byPart.get(part) ?? []) keep(other);
  }
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    const piece = byId.get(id) as LegoPiece;
    if (piece.module) {
      for (const other of byInstance.get(piece.module.instance) ?? [])
        keep(other);
    }
    const part = parts.get(piece.id);
    if (part !== undefined) {
      for (const other of byPart.get(part) ?? []) keep(other);
    }
    if (piece.bone !== undefined) {
      for (const child of children.get(piece.id) ?? []) {
        if (parts.has(child)) keep(child);
      }
    }
    const parent = piece.parentId ? byId.get(piece.parentId) : undefined;
    if (parent && parent.bone === undefined) keep(parent.id);
  }
  return kept;
}

/** The module instances missing a stamped piece. A stamp names the instance
 *  its piece was in, after the hash. */
function deletedInstances(project: LegoProject): Set<string> {
  const stamps = project.generated?.stamps ?? {};
  const present = new Set(project.pieces.map((p) => p.id));
  const out = new Set<string>();
  for (const [id, stamp] of Object.entries(stamps)) {
    const space = stamp.indexOf(" ");
    if (!present.has(id) && space >= 0) out.add(stamp.slice(space + 1));
  }
  return out;
}

/** The parts the game maker deleted whole, so the reroll leaves them out. */
interface Gone {
  slots: Set<string>;
  /** Bones whose covering is all deleted. */
  covering: Set<string>;
  /** `bone|kind` whose wheels or treads are all deleted. */
  running: Set<string>;
  bones: Set<string>;
}

function goneParts(project: LegoProject, boneIds: string[]): Gone {
  const generated = project.generated as LegoGenerated;
  const ids = new Set(project.pieces.map((p) => p.id));
  const instances = new Set(project.pieces.map((p) => p.module?.instance));
  const bones = new Set(project.pieces.map((p) => p.bone));
  return {
    slots: new Set(
      generated.modules
        .filter((m) => !instances.has(m.instance))
        .map((m) => m.slot),
    ),
    covering: allGone(generated.covering ?? [], (c) => c.bone, ids),
    running: allGone(
      generated.running ?? [],
      (r) => `${r.bone}|${r.kind}`,
      ids,
    ),
    bones: new Set(boneIds.filter((bone) => !bones.has(bone))),
  };
}

/** The keys of `entries` none of whose pieces are left. */
function allGone<T extends { piece: string }>(
  entries: readonly T[],
  key: (entry: T) => string,
  ids: Set<string>,
): Set<string> {
  const left = new Set(entries.filter((e) => ids.has(e.piece)).map(key));
  return new Set(entries.map(key).filter((k) => !left.has(k)));
}

/** The top piece of a module instance: the one whose parent is not in it. */
function instanceTop(
  project: LegoProject,
  instance: string,
): LegoPiece | undefined {
  const inside = new Set(
    project.pieces
      .filter((p) => p.module?.instance === instance)
      .map((p) => p.id),
  );
  return project.pieces.find(
    (p) => inside.has(p.id) && !(p.parentId && inside.has(p.parentId)),
  );
}

/**
 * The fresh unit with the old unit's kept parts swapped in. The old unit's
 * name, loadouts, notes and everything else not about pieces stay as they
 * were. Bones keep the old unit's piece ids.
 */
export function mergeReroll(
  old: LegoProject,
  fresh: LegoProject,
  kept: Set<string>,
  gone: Gone,
): LegoProject {
  const was = old.generated as LegoGenerated;
  const made = fresh.generated as LegoGenerated;
  const oldById = new Map(old.pieces.map((p) => [p.id, p]));
  const freshById = new Map(fresh.pieces.map((p) => [p.id, p]));

  // Fresh piece id to the id it takes in the result.
  const rename = new Map<string, string>();
  const removed = new Set<string>();
  const oldBones = new Map<string, LegoPiece>();
  for (const piece of old.pieces) {
    if (piece.bone !== undefined) oldBones.set(piece.bone, piece);
  }
  for (const piece of fresh.pieces) {
    if (piece.bone === undefined) continue;
    const match = oldBones.get(piece.bone);
    if (match) rename.set(piece.id, match.id);
    else if (gone.bones.has(piece.bone) && piece.id !== fresh.rootPieceId)
      removed.add(piece.id);
  }

  const keptInstances = new Set(
    old.pieces
      .filter((p) => kept.has(p.id) && p.module)
      .map((p) => p.module?.instance),
  );
  const oldSlots = new Map(was.modules.map((m) => [m.slot, m.instance]));
  const modules: LegoGenerated["modules"] = [];
  for (const entry of made.modules) {
    const before = oldSlots.get(entry.slot);
    const replaced = before !== undefined && keptInstances.has(before);
    if (!replaced && !gone.slots.has(entry.slot)) {
      modules.push(entry);
      continue;
    }
    for (const piece of fresh.pieces) {
      if (piece.module?.instance === entry.instance) removed.add(piece.id);
    }
    // What the fresh module carried now hangs on the kept one.
    const top = instanceTop(fresh, entry.instance);
    const oldTop = before && replaced ? instanceTop(old, before) : undefined;
    if (top && oldTop) rename.set(top.id, oldTop.id);
  }
  // A deleted part stays in the record with no pieces, so the next reroll
  // still sees it deleted.
  const oldInstances = new Set(old.pieces.map((p) => p.module?.instance));
  modules.push(
    ...was.modules.filter(
      (m) => keptInstances.has(m.instance) || !oldInstances.has(m.instance),
    ),
  );
  const oldIds = new Set(old.pieces.map((p) => p.id));

  const keptCovering = (was.covering ?? []).filter((c) => kept.has(c.piece));
  const coveredBones = new Set([
    ...keptCovering.map((c) => c.bone),
    ...gone.covering,
  ]);
  const covering = (made.covering ?? []).filter((c) => {
    if (!coveredBones.has(c.bone)) return true;
    removed.add(c.piece);
    return false;
  });
  covering.push(
    ...keptCovering,
    ...(was.covering ?? []).filter(
      (c) => !oldIds.has(c.piece) && coveredBones.has(c.bone),
    ),
  );

  const keptRunning = (was.running ?? []).filter((r) => kept.has(r.piece));
  const runningKeys = new Set([
    ...keptRunning.map((r) => `${r.bone}|${r.kind}`),
    ...gone.running,
  ]);
  const running = (made.running ?? []).filter((r) => {
    if (!runningKeys.has(`${r.bone}|${r.kind}`)) return true;
    removed.add(r.piece);
    return false;
  });
  running.push(
    ...keptRunning,
    ...(was.running ?? []).filter(
      (r) => !oldIds.has(r.piece) && runningKeys.has(`${r.bone}|${r.kind}`),
    ),
  );

  /** Where a fresh piece's parent is in the result: up past anything removed
   *  that nothing replaced. */
  const parentOf = (parentId: string | null): string | null => {
    let id = parentId;
    while (id !== null && removed.has(id) && !rename.has(id)) {
      id = freshById.get(id)?.parentId ?? null;
    }
    return id === null ? null : (rename.get(id) ?? id);
  };
  const renamed = (id: string) => rename.get(id) ?? id;

  const pieces: LegoPiece[] = [];
  for (const piece of fresh.pieces) {
    if (removed.has(piece.id)) continue;
    const id = renamed(piece.id);
    const before = piece.bone !== undefined ? oldById.get(id) : undefined;
    if (before && kept.has(before.id)) {
      pieces.push(before);
      continue;
    }
    pieces.push({
      ...piece,
      id,
      parentId: parentOf(piece.parentId),
      ...(piece.twin !== undefined ? { twin: renamed(piece.twin) } : {}),
      ...(piece.ring
        ? { ring: { ...piece.ring, next: renamed(piece.ring.next) } }
        : {}),
    });
  }
  const present = new Set(pieces.map((p) => p.id));
  for (const piece of old.pieces) {
    if (kept.has(piece.id) && !present.has(piece.id)) pieces.push(piece);
  }
  present.clear();
  for (const piece of pieces) present.add(piece.id);
  const rooted = pieces.map((piece) =>
    piece.parentId !== null && !present.has(piece.parentId)
      ? { ...piece, parentId: old.rootPieceId }
      : piece,
  );

  const { stamps: _stamps, ...record } = made;
  return withoutDanglingTwins({
    ...old,
    pieces: rooted,
    skeleton: kept.size > 0 ? old.skeleton : fresh.skeleton,
    generated: {
      ...record,
      modules,
      ...(made.covering || keptCovering.length > 0 ? { covering } : {}),
      ...(made.running || keptRunning.length > 0 ? { running } : {}),
    },
  });
}

/** `repairCandidate`, which never drops a kept covering part. */
function repairKeeping(
  project: LegoProject,
  pack: LoadedPack,
  kept: Set<string>,
): LegoProject {
  const generated = project.generated as LegoGenerated;
  const all = generated.covering;
  if (!all) return repairCandidate(project, pack);
  const held = all.filter((c) => kept.has(c.piece));
  const repaired = repairCandidate(
    {
      ...project,
      generated: {
        ...generated,
        covering: all.filter((c) => !kept.has(c.piece)),
      },
    },
    pack,
  );
  const after = repaired.generated as LegoGenerated;
  return {
    ...repaired,
    generated: { ...after, covering: [...(after.covering ?? []), ...held] },
  };
}

/** The stamps of pieces deleted before the reroll carried into its result, so
 *  a module with a piece deleted stays edited on the next reroll too. */
function withDeletedStamps(unit: LegoProject, old: LegoProject): LegoProject {
  const generated = unit.generated as LegoGenerated;
  const before = new Set(old.pieces.map((p) => p.id));
  const carried = Object.entries(old.generated?.stamps ?? {}).filter(
    ([id]) => !before.has(id),
  );
  if (carried.length === 0) return unit;
  return {
    ...unit,
    generated: {
      ...generated,
      stamps: { ...generated.stamps, ...Object.fromEntries(carried) },
    },
  };
}

/**
 * A new unit from `project`'s record and the seed after the one it records,
 * with its kept parts, that passes the construction checks. Moves on a seed at
 * a time, up to `tries` seeds, as a new unit does. `project` itself is left as
 * it is, so a reroll is one edit that undo takes back.
 */
export function rerollUnit(
  project: LegoProject,
  options: RerollOptions,
): RerollResult {
  const generated = project.generated;
  if (!generated) {
    return { status: "failed", message: t`This unit was not generated.` };
  }
  const plan = bodyPlanById(generated.plan);
  if (!plan || !project.skeleton) {
    return {
      status: "failed",
      message: t`This unit no longer has the skeleton it was generated on, so it cannot be rerolled.`,
    };
  }
  const jobDef = GENERATOR_JOBS.find((j) => j.id === generated.job);
  if (!jobDef || !(generated.size in jobDef.size)) {
    const job = generated.job;
    const size = generated.size;
    return {
      status: "failed",
      message: t`This version cannot generate the job ${job} at size ${size}, so the unit cannot be rerolled.`,
    };
  }
  const tries = options.tries ?? GENERATOR_TRIES;
  const kept = keptPieces(project);
  const edited = editedPieces(project);
  const boneIds = plan
    .bones(planProportions(plan, project.skeleton.proportions))
    .map((bone) => bone.id);
  const gone = goneParts(project, boneIds);
  // Deleted pieces' ids too, since their stamps are carried over below.
  const taken = new Set([
    ...project.pieces.map((p) => p.id),
    ...Object.keys(generated.stamps ?? {}),
  ]);
  // A kept piece edited by hand keeps the stamp it had, so it stays edited.
  const stamps = new Map<string, string | undefined>();
  for (const id of kept) {
    if (edited.has(id)) stamps.set(id, generated.stamps?.[id]);
  }

  let seed = nextSeed(generated.seed);
  const first = seed;
  let last = seed;
  for (let n = 1; n <= tries; n++) {
    last = seed;
    let counter = 0;
    const prefix = `${project.id}.${seed}`;
    const newId = () => {
      let id = `${prefix}.${++counter}`;
      while (taken.has(id)) id = `${prefix}.${++counter}`;
      return id;
    };
    const fresh = generateUnit(
      {
        seed,
        plan,
        job: generated.job as GeneratorJob,
        size: generated.size as GeneratorSize,
      },
      {
        id: project.id,
        rootPieceId: project.rootPieceId,
        now: project.updatedAt,
        pack: options.pack,
        modules: options.modules,
        newId,
        ...(kept.size > 0 ? { proportions: project.skeleton.proportions } : {}),
        ...(generated.style ? { style: generated.style } : {}),
      },
    );
    const merged = resolveConnections(
      mergeReroll(project, fresh, kept, gone),
      options.pack,
    ).project;
    const unit = repairKeeping(merged, options.pack, kept);
    if (generatorFaults(unit, options.pack).length === 0) {
      return {
        status: "ok",
        unit: withDeletedStamps(withStamps(unit, stamps), project),
        seed,
        tries: n,
      };
    }
    seed = nextSeed(seed);
  }
  return {
    status: "failed",
    message: t`No seed from ${first} to ${last} made a unit with the kept parts that passes the checks. Free some parts and try again.`,
  };
}
