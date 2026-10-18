/**
 * Saved poses (#3355): a stance held without changing the unit.
 *
 * A pose is a set of changes from the built shape, per piece id, in the units a
 * script's `Turn` and `Move` take. The timeline of poses that exports as Lua
 * (#3356) reads `LegoPose.pieces` directly: for each piece, `turn[axis]` is the
 * destination of `Turn(piece, axis, ...)` in radians and `move[axis]` that of
 * `Move(piece, axis, ...)` in elmos, with axes in the order x, y, z. A piece
 * that is absent from a pose is at rest in it.
 *
 * Nothing here touches a piece's own transform. Everything is pure, so the
 * builder can make each function one edit of the document.
 */

import type { LegoPose, LegoPoseOffset, LegoProject } from "./model";

/** The working pose while posing: the offsets of the pieces it changes. */
export type PoseOffsets = Record<string, LegoPoseOffset>;

type Triple = [number, number, number];

const isZero = (v: Triple | undefined) =>
  v === undefined || v.every((n) => n === 0);

/** Whether an offset changes nothing, so it need not be stored. */
export function isRestOffset(offset: LegoPoseOffset): boolean {
  return isZero(offset.turn) && isZero(offset.move);
}

/** An offset with the parts that change nothing left out. */
function trimmed(offset: LegoPoseOffset): LegoPoseOffset {
  return {
    ...(isZero(offset.turn) ? {} : { turn: offset.turn }),
    ...(isZero(offset.move) ? {} : { move: offset.move }),
  };
}

/**
 * The offsets with one piece's replaced. A piece put back to rest drops out, so
 * a pose holds only what it changes.
 */
export function withPieceOffset(
  offsets: PoseOffsets,
  pieceId: string,
  offset: LegoPoseOffset,
): PoseOffsets {
  const { [pieceId]: _was, ...rest } = offsets;
  const next = trimmed(offset);
  return isRestOffset(next) ? rest : { ...rest, [pieceId]: next };
}

/**
 * The offset a piece's group has when it is at `turn` and `position` with its
 * rest at `rest`. `turn` must be read in the engine's order (`YXZ`).
 */
export function offsetFromTransform(
  turn: Triple,
  position: Triple,
  rest: Triple,
): LegoPoseOffset {
  return {
    turn,
    move: [position[0] - rest[0], position[1] - rest[1], position[2] - rest[2]],
  };
}

/** The ids of the pieces a pose names that the unit no longer has. */
export function missingPieces(pose: LegoPose, project: LegoProject): string[] {
  const have = new Set(project.pieces.map((piece) => piece.id));
  return Object.keys(pose.pieces).filter((id) => !have.has(id));
}

/** The pose's offsets for the pieces the unit has. */
export function offsetsOf(pose: LegoPose, project: LegoProject): PoseOffsets {
  const have = new Set(project.pieces.map((piece) => piece.id));
  const out: PoseOffsets = {};
  for (const [id, offset] of Object.entries(pose.pieces)) {
    if (have.has(id)) out[id] = { ...offset };
  }
  return out;
}

/** A name not yet used by a pose of the unit: `base`, then `base 2`, ... */
export function freePoseName(project: LegoProject, base: string): string {
  const taken = new Set((project.poses ?? []).map((pose) => pose.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}

/** Save the offsets as a new pose at the end of the list. */
export function savePose(
  project: LegoProject,
  options: { id: string; name: string; offsets: PoseOffsets },
): LegoProject {
  const name = options.name.trim() || "Pose";
  const pose: LegoPose = {
    id: options.id,
    name: freePoseName(project, name),
    pieces: copyOffsets(options.offsets),
  };
  return { ...project, poses: [...(project.poses ?? []), pose] };
}

/** Replace what a saved pose holds, keeping its name and place. */
export function overwritePose(
  project: LegoProject,
  id: string,
  offsets: PoseOffsets,
): LegoProject {
  if (!project.poses?.some((pose) => pose.id === id)) return project;
  return {
    ...project,
    poses: project.poses.map((pose) =>
      pose.id === id ? { ...pose, pieces: copyOffsets(offsets) } : pose,
    ),
  };
}

/** Rename a pose. A blank name, or one another pose has, changes nothing. */
export function renamePose(
  project: LegoProject,
  id: string,
  name: string,
): LegoProject {
  const next = name.trim();
  const poses = project.poses;
  if (!poses || next === "") return project;
  if (poses.some((pose) => pose.id !== id && pose.name === next)) {
    return project;
  }
  if (!poses.some((pose) => pose.id === id && pose.name !== next)) {
    return project;
  }
  return {
    ...project,
    poses: poses.map((pose) =>
      pose.id === id ? { ...pose, name: next } : pose,
    ),
  };
}

/** Copy a pose to just after itself, under a name of its own. */
export function duplicatePose(
  project: LegoProject,
  id: string,
  newId: string,
): LegoProject {
  const poses = project.poses;
  const at = poses?.findIndex((pose) => pose.id === id) ?? -1;
  if (!poses || at < 0) return project;
  const copy: LegoPose = {
    id: newId,
    name: freePoseName(project, `${poses[at].name} copy`),
    pieces: copyOffsets(poses[at].pieces),
  };
  return {
    ...project,
    poses: [...poses.slice(0, at + 1), copy, ...poses.slice(at + 1)],
  };
}

/** Delete a pose. The last one going takes the key with it. */
export function deletePose(project: LegoProject, id: string): LegoProject {
  if (!project.poses?.some((pose) => pose.id === id)) return project;
  const { poses: _was, ...rest } = project;
  const poses = project.poses.filter((pose) => pose.id !== id);
  return poses.length > 0 ? { ...rest, poses } : rest;
}

function copyOffsets(offsets: PoseOffsets): PoseOffsets {
  const out: PoseOffsets = {};
  for (const [id, offset] of Object.entries(offsets)) {
    const next = trimmed({
      turn: offset.turn ? [...offset.turn] : undefined,
      move: offset.move ? [...offset.move] : undefined,
    });
    if (!isRestOffset(next)) out[id] = next;
  }
  return out;
}

/**
 * The working pose with its own undo, because an edit while posing is not an
 * edit of the unit and the unit's history must not record it.
 */
export interface PoseDraft {
  offsets: PoseOffsets;
  past: PoseOffsets[];
  future: PoseOffsets[];
}

export const emptyDraft: PoseDraft = { offsets: {}, past: [], future: [] };

export type PoseDraftAction =
  | { type: "set"; pieceId: string; offset: LegoPoseOffset }
  /** Start from these offsets, as one step that undo can step back over. */
  | { type: "load"; offsets: PoseOffsets }
  | { type: "undo" }
  | { type: "redo" }
  /** Leave posing: the draft and its history go. */
  | { type: "clear" };

/** Steps kept, matching the document's own history. */
const DRAFT_LIMIT = 60;

export function reduceDraft(
  state: PoseDraft,
  action: PoseDraftAction,
): PoseDraft {
  switch (action.type) {
    case "set":
      return step(
        state,
        withPieceOffset(state.offsets, action.pieceId, action.offset),
      );
    case "load":
      return step(state, copyOffsets(action.offsets));
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        offsets: previous,
        past: state.past.slice(0, -1),
        future: [state.offsets, ...state.future],
      };
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) return state;
      return {
        offsets: next,
        past: [...state.past, state.offsets],
        future,
      };
    }
    case "clear":
      return emptyDraft;
  }
}

function step(state: PoseDraft, offsets: PoseOffsets): PoseDraft {
  if (JSON.stringify(offsets) === JSON.stringify(state.offsets)) return state;
  return {
    offsets,
    past: [...state.past, state.offsets].slice(-DRAFT_LIMIT),
    future: [],
  };
}
