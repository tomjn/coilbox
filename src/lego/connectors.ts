/**
 * Where parts join, and placing a piece from its join (issue #3273).
 *
 * A connector is a point on a part, the way out of the part it faces, and an up
 * direction along the face that fixes the twist, all in the part's own space.
 * A piece's `connection` names one of its own connectors and one of its
 * parent's, and the piece is placed so the two points meet and the two faces
 * point at each other.
 *
 * The result is written back to the piece's `position` and `rotation`, rather
 * than worked out each time a transform is read. The scene, the bake, mirror,
 * the clipboard and every exporter read those fields, and none of them has to
 * know a join exists. The cost is that anything which could move a joined piece
 * has to resolve again, which `withConnections` does for every builder edit and
 * `bakedPieces` does once more before a bake.
 *
 * Only the piece's own frame and its parent's part go into a join, never the
 * parent's transform, because the piece's transform is written against its
 * parent. So joins resolve one piece at a time, in any order.
 */

import * as THREE from "three";

import type {
  LegoAnchor,
  LegoConnection,
  LegoPiece,
  LegoProject,
} from "./model";
import type { LoadedPack } from "./pack";
import { framesAgree, isJoined, localFromWorld, worldMatrix } from "./reparent";
import type { Bounds, Vec3 } from "./snapping";

export interface LegoConnector {
  /** Stable across parts, so a join survives a part being swapped. */
  id: string;
  /** In the part's own space, the same space as a piece's `pivot`. */
  position: Vec3;
  /** Unit length, pointing out of the part. */
  facing: Vec3;
  /** Unit length and along the face, so at right angles to `facing`. */
  up: Vec3;
}

/**
 * One connector at the middle of each face of a box, facing out of it.
 *
 * The up direction follows one rule, so a twist means the same on every part:
 * up is +y on the four side faces, and +z (the unit's forward) on the top and
 * the bottom, where +y would be the facing itself. Ids are the facing's axis
 * and sign, so `+y` is the top of any part.
 */
export function boxConnectors(bounds: Bounds): LegoConnector[] {
  const { min, max } = bounds;
  const mid: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const connectors: LegoConnector[] = [];
  for (const axis of [0, 1, 2]) {
    for (const sign of [1, -1]) {
      const position: Vec3 = [...mid];
      position[axis] = sign > 0 ? max[axis] : min[axis];
      const facing: Vec3 = [0, 0, 0];
      facing[axis] = sign;
      connectors.push({
        id: `${sign > 0 ? "+" : "-"}${"xyz"[axis]}`,
        position,
        facing,
        up: axis === 1 ? [0, 0, 1] : [0, 1, 0],
      });
    }
  }
  return connectors;
}

/** How far from exact a stated length or angle may be: rounding in a
 *  hand written or exported `pack.json`, not a different direction. */
const STATED_TOLERANCE = 1e-3;

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** What is wrong with one stated connector, or null when it is fine. */
function statedProblem(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return "it is not an object";
  }
  const { id, position, facing, up } = entry as Record<string, unknown>;
  if (typeof id !== "string" || id === "") {
    return "its id is not a name";
  }
  if (!isVec3(position)) return "its position is not three numbers";
  if (
    !isVec3(facing) ||
    Math.abs(Math.hypot(...facing) - 1) > STATED_TOLERANCE
  ) {
    return "its facing is not three numbers of unit length";
  }
  if (!isVec3(up) || Math.abs(Math.hypot(...up) - 1) > STATED_TOLERANCE) {
    return "its up is not three numbers of unit length";
  }
  const dot = facing[0] * up[0] + facing[1] * up[1] + facing[2] * up[2];
  if (Math.abs(dot) > STATED_TOLERANCE) {
    return "its up is not at right angles to its facing";
  }
  return null;
}

/**
 * The connectors a pack states for a part, or why they cannot be used.
 *
 * A list is taken whole or not at all. Half a list would leave a part with some
 * of the connectors its author meant and a join to the others silently broken,
 * so one bad entry sends the part back to the connectors its box gives it.
 */
export function readPartConnectors(
  raw: unknown,
): { connectors: LegoConnector[] } | { problem: string } {
  if (!Array.isArray(raw)) {
    return { problem: "connectors is not a list" };
  }
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const problem = statedProblem(entry);
    if (problem) {
      const id = (entry as { id?: unknown } | null)?.id;
      const name = typeof id === "string" && id !== "" ? ` "${id}"` : "";
      return { problem: `connector ${index + 1}${name}: ${problem}` };
    }
    const { id } = entry as LegoConnector;
    if (seen.has(id)) {
      return { problem: `it names "${id}" twice` };
    }
    seen.add(id);
  }
  return { connectors: raw as LegoConnector[] };
}

/** Up for a facing: +y, or +z when the facing is too close to +y for it, which
 *  is the rule `boxConnectors` follows on the top and bottom. */
function defaultUp(facing: Vec3): Vec3 {
  const alongY = Math.abs(facing[1]) > 0.9;
  const base = new THREE.Vector3(0, alongY ? 0 : 1, alongY ? 1 : 0);
  const f = new THREE.Vector3(...facing);
  base.addScaledVector(f, -base.dot(f)).normalize();
  return [base.x, base.y, base.z];
}

/** The unit step out of the nearest face of a box from a point, or null with
 *  no box to measure. A point in the middle falls to +x, a tie to the first
 *  axis. */
function nearestFacing(
  position: Vec3,
  bounds: Bounds | undefined,
): Vec3 | null {
  if (!bounds) return null;
  let best: { distance: number; axis: number; sign: number } | null = null;
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [1, -1]) {
      const edge = sign > 0 ? bounds.max[axis] : bounds.min[axis];
      const distance = Math.abs(edge - position[axis]);
      if (!best || distance < best.distance) best = { distance, axis, sign };
    }
  }
  if (!best) return null;
  const facing: Vec3 = [0, 0, 0];
  facing[best.axis] = best.sign;
  return facing;
}

/**
 * A piece's custom anchors as connectors (issue #3290). An anchor with a
 * facing uses it. One without, saved before anchors had a facing, points out
 * of the nearest face of the part's box, so an old unit opens unchanged and its
 * anchors still seat parts. With neither a facing nor a box to take one from, an
 * anchor stays a position only and is left out.
 *
 * The id is the anchor's own, so a join to it survives a rename.
 */
export function customConnectors(
  anchors: readonly LegoAnchor[],
  bounds: Bounds | undefined,
): LegoConnector[] {
  const connectors: LegoConnector[] = [];
  for (const anchor of anchors) {
    const facing = anchor.facing ?? nearestFacing(anchor.position, bounds);
    if (!facing) continue;
    const f = new THREE.Vector3(...facing).normalize();
    const stated = anchor.up && new THREE.Vector3(...anchor.up);
    let up = defaultUp([f.x, f.y, f.z]);
    if (stated) {
      // Taken at right angles to the facing, because a stated up that leans on
      // it would not be a direction along the face.
      stated.addScaledVector(f, -stated.dot(f));
      if (stated.lengthSq() > 0) {
        stated.normalize();
        up = [stated.x, stated.y, stated.z];
      }
    }
    connectors.push({
      id: anchor.id,
      position: anchor.position,
      facing: [f.x, f.y, f.z],
      up,
    });
  }
  return connectors;
}

/**
 * The connectors a piece can be joined by, or none for a piece with nothing to
 * join by. A piece's own custom anchors come first and stand in for the
 * part's, as they do for snapping. Otherwise a part's own list is used as it is
 * and the box's are not added to it: the box is a guess, and the parts that
 * state their own are the ones it gets wrong.
 */
export function pieceConnectors(
  pack: LoadedPack,
  piece: LegoPiece,
): LegoConnector[] {
  const part = piece.partId ? pack.byId.get(piece.partId) : undefined;
  const bounds = part?.bbox ?? piece.meshBox;
  const own = customConnectors(piece.customAnchors ?? [], bounds);
  if (own.length > 0) return own;
  if (part) return part.connectors ?? boxConnectors(part.bbox);
  // A lifted piece has no part, so its mesh's box stands in for the part's.
  return piece.meshBox ? boxConnectors(piece.meshBox) : [];
}

/**
 * A connector's facing and up as a joined child sees them under a parent of
 * world scale `scale`. A face's direction goes through the inverse scale, which
 * turns a mirrored parent's "+x" face round to the side it is now on. An up
 * along the face goes through the scale itself.
 */
function scaledFrame(
  connector: Pick<LegoConnector, "facing" | "up">,
  scale: THREE.Vector3,
): { facing: THREE.Vector3; up: THREE.Vector3 } {
  const facing = new THREE.Vector3(...connector.facing)
    .divide(scale)
    .normalize();
  const up = new THREE.Vector3(...connector.up).multiply(scale);
  up.addScaledVector(facing, -up.dot(facing)).normalize();
  return { facing, up };
}

/** A parent's scale in the world, which is the scale a joined child leaves out. */
export function parentScaleOf(
  project: LegoProject,
  parentId: string,
): THREE.Vector3 {
  const scale = new THREE.Vector3();
  worldMatrix(project, parentId).decompose(
    new THREE.Vector3(),
    new THREE.Quaternion(),
    scale,
  );
  return scale;
}

/** Where a joined piece goes, against its parent. */
interface Placement {
  position: Vec3;
  rotation: Vec3;
}

/**
 * Where a piece's join puts it, or null when the join cannot be made: either
 * connector is missing, the piece has no parent, or its scale has a zero in it.
 */
export function placeJoin(
  pack: LoadedPack,
  piece: LegoPiece,
  parent: LegoPiece,
  connection: LegoConnection,
  parentScale: THREE.Vector3,
): Placement | null {
  const own = pieceConnectors(pack, piece).find(
    (c) => c.id === connection.connector,
  );
  const theirs = pieceConnectors(pack, parent).find(
    (c) => c.id === connection.to,
  );
  if (!own || !theirs) return null;
  if (piece.scale.some((s) => s === 0)) return null;

  // The parent's connector, in the space its children are written in: its
  // part's space less its pivot.
  const parentPivot = new THREE.Vector3(...(parent.pivot ?? [0, 0, 0]));
  const faceOut = new THREE.Vector3(...theirs.facing).normalize();
  const faceUp = new THREE.Vector3(...theirs.up).normalize();
  const side = new THREE.Vector3().crossVectors(faceOut, faceUp);
  const [along, across] = connection.offset ?? [0, 0];
  const target = new THREE.Vector3(...theirs.position)
    .sub(parentPivot)
    .addScaledVector(side, along)
    .addScaledVector(faceUp, across);

  // The point is carried out by the parent's full matrix, but the piece's turn
  // is only the parent's turn. So the face the piece meets is the parent's face
  // as it sits in the world, scale and mirror included.
  const { facing, up } = scaledFrame(theirs, parentScale);
  const twistedUp = up
    .clone()
    .applyAxisAngle(facing, connection.twist ?? 0)
    .normalize();

  // The piece's own connector after its scale. A face's direction goes through
  // the inverse scale, which is what turns a mirrored part's "+x" face round to
  // the side it is now on.
  const scale = new THREE.Vector3(...piece.scale);
  const point = new THREE.Vector3(...own.position)
    .sub(new THREE.Vector3(...(piece.pivot ?? [0, 0, 0])))
    .multiply(scale);
  const ownFacing = new THREE.Vector3(...own.facing).divide(scale).normalize();
  const ownUp = new THREE.Vector3(...own.up).multiply(scale);
  ownUp.addScaledVector(ownFacing, -ownUp.dot(ownFacing)).normalize();

  // Turn the piece's connector frame onto the parent's, facing back into it.
  const from = frame(ownFacing, ownUp);
  const to = frame(facing.clone().negate(), twistedUp);
  const turn = to.multiply(from.transpose());
  const rotation = new THREE.Euler().setFromRotationMatrix(turn);

  // The piece's own offset from its connector is not carried by the parent's
  // scale, so it is divided by it to land the connector on the target.
  const position = target.sub(point.applyMatrix4(turn).divide(parentScale));
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z],
  };
}

/**
 * Where a joined piece dragged to `position` lands when it can only slide along
 * the face it is joined to (issue #3285).
 *
 * The part of the drag that goes through the face is dropped, and the rest
 * becomes an offset along the face. That offset moves in whole `step`s from the
 * one the join rests at, so a join that is not on the step stays off it by the
 * same amount. A step of zero or less leaves the offset free. Nothing stops the
 * offset running past the edge of the face, because a part overhanging a hull is
 * legitimate.
 *
 * `position` is in the parent's space, the space a piece's own position is
 * written in. Null when the piece has no join that can be made.
 */
export function slideJoin(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  position: Vec3,
  step: number,
): { offset: [number, number]; position: Vec3 } | null {
  const piece = project.pieces.find((p) => p.id === pieceId);
  const connection = piece?.connection;
  const parent = piece?.parentId
    ? project.pieces.find((p) => p.id === piece.parentId)
    : undefined;
  if (!piece || !connection || !parent) return null;

  const parentScale = parentScaleOf(project, parent.id);
  const at = (offset: [number, number]) =>
    placeJoin(pack, piece, parent, { ...connection, offset }, parentScale);
  const origin = at([0, 0]);
  const along = at([1, 0]);
  const across = at([0, 1]);
  if (!origin || !along || !across) return null;

  // One offset unit moves the piece one unit along the face, so the drag read
  // along each direction is the offset that reaches it.
  const drag = new THREE.Vector3(...position).sub(
    new THREE.Vector3(...origin.position),
  );
  const raw = [along, across].map((placed) =>
    drag.dot(
      new THREE.Vector3(...placed.position).sub(
        new THREE.Vector3(...origin.position),
      ),
    ),
  );
  const from = connection.offset ?? [0, 0];
  const offset = raw.map((value, i) =>
    step > 0 ? from[i] + Math.round((value - from[i]) / step) * step : value,
  ) as [number, number];

  const placed = at(offset);
  return placed ? { offset, position: placed.position } : null;
}

/**
 * The angle about the parent's connector that leaves the piece turned as it is.
 *
 * The piece's up direction is carried into the parent's child space, which is
 * where the join is written, and measured from the parent connector's up.
 * Nothing in a drag sets a twist, so this is what stops a join resolving to a
 * quarter turn from where the piece was dropped.
 */
export function twistOf(
  project: LegoProject,
  pack: LoadedPack,
  piece: LegoPiece,
  pieceWorld: THREE.Matrix4,
  parent: LegoPiece,
  join: Pick<LegoConnection, "connector" | "to">,
): number {
  const own = pieceConnectors(pack, piece).find((c) => c.id === join.connector);
  const theirs = pieceConnectors(pack, parent).find((c) => c.id === join.to);
  if (!own || !theirs) return 0;

  // The piece will be joined, so it takes the parent's turn and not its scale.
  const parentTurn = new THREE.Quaternion();
  const parentScale = new THREE.Vector3();
  worldMatrix(project, parent.id).decompose(
    new THREE.Vector3(),
    parentTurn,
    parentScale,
  );
  const up = new THREE.Vector3(...own.up)
    .transformDirection(pieceWorld)
    .applyQuaternion(parentTurn.invert());
  const { facing, up: from } = scaledFrame(theirs, parentScale);
  up.addScaledVector(facing, -up.dot(facing)).normalize();

  const twist = Math.atan2(
    facing.dot(new THREE.Vector3().crossVectors(from, up)),
    from.dot(up),
  );
  return Number.isFinite(twist) ? twist : 0;
}

/** Below this an offset or a twist is rounding, and is left out of a join. */
const NONE = 1e-9;

/**
 * The document with a piece joined by its own `connector` to whichever face of
 * its parent puts it at `world`, or null when no face does (issue #3309).
 *
 * Each of the parent's connectors is tried, with the twist and the offset along
 * the face that would leave the piece at `world`, and the first whose join puts
 * it there wins. Mirror and symmetry join a reflected piece this way, so which
 * face the reflection sits on, and which way a twist or an offset turns round,
 * is measured rather than worked out for each face.
 *
 * `world` is asked for rather than read off the piece, because a free piece
 * under a parent scaled unevenly cannot always hold a turned place exactly, and
 * a joined one can.
 */
export function joinAt(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  connector: string,
  world: THREE.Matrix4,
): LegoProject | null {
  const piece = project.pieces.find((p) => p.id === pieceId);
  const parent = piece?.parentId
    ? project.pieces.find((p) => p.id === piece.parentId)
    : undefined;
  if (!piece || !parent) return null;

  // A joined piece keeps its own size, so its transform is written that way
  // before any join is measured from it.
  const local = transformOf(localFromWorld(project, parent.id, world, true));
  const parentScale = parentScaleOf(project, parent.id);
  const withPiece = (next: LegoPiece): LegoProject => ({
    ...project,
    pieces: project.pieces.map((p) => (p.id === pieceId ? next : p)),
  });

  for (const theirs of pieceConnectors(pack, parent)) {
    const twist = twistOf(project, pack, piece, world, parent, {
      connector,
      to: theirs.id,
    });
    const twisted: LegoPiece = {
      ...piece,
      ...local,
      connection: {
        connector,
        to: theirs.id,
        ...(Math.abs(twist) > NONE ? { twist } : {}),
      },
    };
    const slid = slideJoin(
      withPiece(twisted),
      pack,
      pieceId,
      local.position,
      0,
    );
    if (!slid) continue;
    const offset = slid.offset.map((n) => (Math.abs(n) > NONE ? n : 0)) as [
      number,
      number,
    ];
    const connection: LegoConnection = {
      ...(twisted.connection as LegoConnection),
      ...(offset[0] || offset[1] ? { offset } : {}),
    };
    const placed = placeJoin(pack, twisted, parent, connection, parentScale);
    if (!placed) continue;
    const joined = withPiece({ ...twisted, ...placed, connection });
    if (framesAgree(worldMatrix(joined, pieceId), world)) return joined;
  }
  return null;
}

/** A right-handed frame with `facing` and `up` as its first two columns. */
function frame(facing: THREE.Vector3, up: THREE.Vector3): THREE.Matrix4 {
  const third = new THREE.Vector3().crossVectors(facing, up);
  return new THREE.Matrix4().makeBasis(facing, up, third);
}

/** Close enough that writing the new value would be rounding, not a move. */
const SAME = 1e-9;

export function same(a: Vec3, b: Vec3): boolean {
  return a.every((n, i) => Math.abs(n - b[i]) < SAME);
}

/**
 * Every joined piece placed from its join.
 *
 * A join that cannot be made leaves the piece on the transform it last had and
 * names it in `broken`, so a swapped part never throws or sends a piece to the
 * origin. Answers the same document when nothing moved, so an edit that touches
 * no joined piece costs no new copy.
 */
export function resolveConnections(
  project: LegoProject,
  pack: LoadedPack,
): { project: LegoProject; broken: string[] } {
  const byId = new Map(project.pieces.map((piece) => [piece.id, piece]));
  const broken: string[] = [];
  let moved = false;
  const pieces = project.pieces.map((piece) => {
    if (!piece.connection) return piece;
    const parent = piece.parentId ? byId.get(piece.parentId) : undefined;
    const placed = parent
      ? placeJoin(
          pack,
          piece,
          parent,
          piece.connection,
          parentScaleOf(project, parent.id),
        )
      : null;
    if (!placed) {
      broken.push(piece.id);
      return piece;
    }
    if (
      same(placed.position, piece.position) &&
      same(placed.rotation, piece.rotation)
    ) {
      return piece;
    }
    moved = true;
    return { ...piece, ...placed };
  });
  return { project: moved ? { ...project, pieces } : project, broken };
}

export interface JoinSummary {
  parentName: string;
  /** The face on the piece's own part. */
  connector: string;
  /** The face on the parent's part. */
  to: string;
  /** `connector` as it is shown: "top" on a box, the id otherwise. */
  connectorName: string;
  /** `to` as it is shown. */
  toName: string;
  offset: [number, number];
  /** Radians. */
  twist: number;
  /** The join cannot be made, so the piece is where it last was. */
  broken: boolean;
}

/** The unit faces +z and its right is -x, so +x is its left. */
const BOX_FACE_NAMES: Record<string, string> = {
  "+y": "top",
  "-y": "bottom",
  "+z": "front",
  "-z": "back",
  "+x": "left",
  "-x": "right",
};

/**
 * A connector's name for showing. A box's six faces have the names of the
 * unit's own directions. A connector a pack or an anchor states keeps its id,
 * because its id may mean something other than a direction.
 */
export function faceName(
  pack: LoadedPack,
  piece: LegoPiece | undefined,
  id: string,
): string {
  const part = piece?.partId ? pack.byId.get(piece.partId) : undefined;
  const boxed =
    (part ? !part.connectors : piece?.meshBox !== undefined) &&
    !(piece?.customAnchors?.length ?? 0);
  return (boxed && BOX_FACE_NAMES[id]) || id;
}

/** What a piece is joined to, for showing, or null for a free piece. */
export function describeJoin(
  project: LegoProject,
  pack: LoadedPack,
  piece: LegoPiece,
): JoinSummary | null {
  const { connection } = piece;
  if (!connection) return null;
  const parent = project.pieces.find((p) => p.id === piece.parentId);
  return {
    parentName: parent?.name ?? "",
    connector: connection.connector,
    to: connection.to,
    connectorName: faceName(pack, piece, connection.connector),
    toName: faceName(pack, parent, connection.to),
    offset: connection.offset ?? [0, 0],
    twist: connection.twist ?? 0,
    broken:
      !parent ||
      !placeJoin(
        pack,
        piece,
        parent,
        connection,
        parentScaleOf(project, parent.id),
      ),
  };
}

export interface FaceOutline {
  /** The piece whose group the outline is drawn in. */
  owner: string;
  kind: "joined" | "free";
  /** Four corners in the owner's group space, in order round the face. */
  corners: Vec3[];
}

/** How much of a face the outline covers, so its edge stays in view. */
const OUTLINE_FILL = 0.8;
/** Used for a connector on a piece with no part to measure a face by. */
const OUTLINE_FALLBACK = 0.25;

function outlineOf(
  pack: LoadedPack,
  piece: LegoPiece,
  connector: LegoConnector,
  kind: FaceOutline["kind"],
): FaceOutline {
  const facing = new THREE.Vector3(...connector.facing).normalize();
  const up = new THREE.Vector3(...connector.up).normalize();
  const side = new THREE.Vector3().crossVectors(facing, up);
  const bbox =
    (piece.partId ? pack.byId.get(piece.partId)?.bbox : undefined) ??
    piece.meshBox;
  const half = (axis: THREE.Vector3) =>
    bbox
      ? 0.5 *
        OUTLINE_FILL *
        (Math.abs(axis.x) * (bbox.max[0] - bbox.min[0]) +
          Math.abs(axis.y) * (bbox.max[1] - bbox.min[1]) +
          Math.abs(axis.z) * (bbox.max[2] - bbox.min[2]))
      : OUTLINE_FALLBACK;
  const [h, v] = [half(side), half(up)];
  const pivot = piece.pivot ?? [0, 0, 0];
  const middle = new THREE.Vector3(
    connector.position[0] - pivot[0],
    connector.position[1] - pivot[1],
    connector.position[2] - pivot[2],
  );
  const corners = (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([a, b]) => {
    const corner = middle
      .clone()
      .addScaledVector(side, a * h)
      .addScaledVector(up, b * v);
    return [corner.x, corner.y, corner.z] as Vec3;
  });
  return { owner: piece.id, kind, corners };
}

/**
 * The face outlines to draw for a selected piece: the face it is joined by and
 * the parent face it is joined to, and with `showFree` the piece's other faces.
 * A join whose parent face is missing draws only the piece's own.
 */
export function joinFaceOutlines(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  showFree: boolean,
): FaceOutline[] {
  const piece = project.pieces.find((p) => p.id === pieceId);
  if (!piece) return [];
  const own = pieceConnectors(pack, piece);
  const outlines: FaceOutline[] = [];
  const { connection } = piece;
  if (connection) {
    const mine = own.find((c) => c.id === connection.connector);
    if (mine) outlines.push(outlineOf(pack, piece, mine, "joined"));
    const parent = project.pieces.find((p) => p.id === piece.parentId);
    const theirs = parent
      ? pieceConnectors(pack, parent).find((c) => c.id === connection.to)
      : undefined;
    if (parent && theirs)
      outlines.push(outlineOf(pack, parent, theirs, "joined"));
  }
  if (showFree) {
    for (const connector of own) {
      if (connector.id !== connection?.connector) {
        outlines.push(outlineOf(pack, piece, connector, "free"));
      }
    }
  }
  return outlines;
}

/**
 * Set where a joined piece rests on its face, and place it there. An offset of
 * nothing and a twist of nothing are stored as absent, as a fresh join has
 * them. A free piece is returned as it is.
 */
export function setJoinPlace(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  change: { offset?: [number, number]; twist?: number },
): LegoProject {
  const connection = project.pieces.find((p) => p.id === pieceId)?.connection;
  if (!connection) return project;
  const { offset: _offset, twist: _twist, ...base } = connection;
  const offset = change.offset ?? connection.offset;
  const twist = change.twist ?? connection.twist;
  return connectPiece(project, pack, pieceId, {
    ...base,
    ...(offset && (offset[0] !== 0 || offset[1] !== 0) ? { offset } : {}),
    ...(twist ? { twist } : {}),
  });
}

/**
 * A builder edit followed by resolving every join, so the edit and the moves it
 * causes are one document and one undo step. With no pack loaded yet there is
 * nothing to measure parts by, and the edit goes through as it is.
 */
export function withConnections(
  change: (project: LegoProject) => LegoProject,
  pack: LoadedPack | null,
): (project: LegoProject) => LegoProject {
  if (!pack) return change;
  return (project) => {
    const next = change(project);
    return next === project ? next : resolveConnections(next, pack).project;
  };
}

/** Join a piece to its parent and place it there. */
export function connectPiece(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  connection: LegoConnection,
): LegoProject {
  return resolveConnections(
    {
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === pieceId ? { ...piece, connection } : piece,
      ),
    },
    pack,
  ).project;
}

/** The piece without its join, left where the join had put it. */
export function freePiece(piece: LegoPiece): LegoPiece {
  if (!piece.connection) return piece;
  const { connection: _dropped, ...rest } = piece;
  return rest;
}

/**
 * Take a piece's join away, leaving it where it stands as a free piece. A
 * joined piece does not take its parent's scale, so the free piece's transform
 * is worked out again to hold the same size and place.
 */
export function disconnectPiece(
  project: LegoProject,
  pieceId: string,
): LegoProject {
  const piece = project.pieces.find((p) => p.id === pieceId);
  if (!piece?.connection) return project;
  const local =
    isJoined(project, piece) && scaledAbove(project, piece)
      ? localFromWorld(
          project,
          piece.parentId,
          worldMatrix(project, pieceId),
          false,
        )
      : undefined;
  return {
    ...project,
    pieces: project.pieces.map((p) =>
      p.id === pieceId
        ? { ...freePiece(p), ...(local ? transformOf(local) : {}) }
        : p,
    ),
  };
}

/** A local matrix as the three fields the document stores. */
export function transformOf(
  local: THREE.Matrix4,
): Pick<LegoPiece, "position" | "rotation" | "scale"> {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  local.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation);
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z],
  };
}

/** Whether the parent's scale is anything but 1, which is when a join matters. */
function scaledAbove(project: LegoProject, piece: LegoPiece): boolean {
  const scale = new THREE.Vector3();
  worldMatrix(project, piece.parentId as string).decompose(
    new THREE.Vector3(),
    new THREE.Quaternion(),
    scale,
  );
  return scale.distanceTo(new THREE.Vector3(1, 1, 1)) > 1e-9;
}
