/**
 * Which connector of a module mounts it on a unit, and dropping a module in by
 * that connector (issue #3297).
 *
 * A module is a `LegoProject` kept in its own folder. Its `mount` names one
 * connector of one of its pieces. Inserting the module puts that connector on a
 * free face of the piece it is dropped onto, the way a part from the strip
 * goes (`attachToFreeFace`). A module without a mount, or whose mount no longer
 * resolves, goes in as `insertCompound` always did.
 */

import * as THREE from "three";

import { insertCompound } from "./compounds";
import {
  faceName,
  type LegoConnector,
  parentScaleOf,
  pieceConnectors,
  placeJoin,
  transformOf,
} from "./connectors";
import {
  type LegoMount,
  type LegoPiece,
  type LegoProject,
  orderedPieces,
  pieceById,
} from "./model";
import type { LoadedPack } from "./pack";
import { type FaceTarget, freeFace, type PlaceOptions } from "./placePart";
import { worldMatrix } from "./reparent";

/** A module with its mount dropped when the piece it names is gone. */
export function clearStaleMount(module: LegoProject): LegoProject {
  if (!module.mount || pieceById(module, module.mount.piece)) return module;
  const { mount: _gone, ...rest } = module;
  return rest;
}

export interface ModuleConnector {
  piece: string;
  connector: string;
  /** For showing: the piece and its face, such as "leg, bottom". */
  label: string;
}

/** Every connector of every piece of a module, in document order. */
export function moduleConnectors(
  module: LegoProject,
  pack: LoadedPack,
): ModuleConnector[] {
  return orderedPieces(module).flatMap((piece) =>
    pieceConnectors(pack, piece).map((connector) => ({
      piece: piece.id,
      connector: connector.id,
      label: `${piece.name}, ${faceName(pack, piece, connector.id)}`,
    })),
  );
}

/** A piece's connector, in the module's own space. */
function inModule(
  module: LegoProject,
  piece: LegoPiece,
  connector: LegoConnector,
): THREE.Vector3 {
  const pivot = piece.pivot ?? [0, 0, 0];
  return new THREE.Vector3(
    connector.position[0] - pivot[0],
    connector.position[1] - pivot[1],
    connector.position[2] - pivot[2],
  ).applyMatrix4(worldMatrix(module, piece.id));
}

/**
 * The mount a module gets when its maker has not chosen: the connector on the
 * lowest point of its first piece. Lowest by height in the module, then the one
 * facing most nearly down, then the first listed. Null when the first piece has
 * no connectors.
 */
export function defaultMount(
  module: LegoProject,
  pack: LoadedPack,
): LegoMount | null {
  const first = pieceById(module, module.rootPieceId);
  if (!first) return null;
  let best: { connector: LegoConnector; y: number } | null = null;
  for (const connector of pieceConnectors(pack, first)) {
    const y = inModule(module, first, connector).y;
    const lower = best && y < best.y - EPSILON;
    const level = best && Math.abs(y - best.y) <= EPSILON;
    if (
      !best ||
      lower ||
      (level && connector.facing[1] < best.connector.facing[1])
    ) {
      best = { connector, y };
    }
  }
  return best ? { piece: first.id, connector: best.connector.id } : null;
}

/** Heights closer than this are the same height. */
const EPSILON = 1e-6;

interface ResolvedMount {
  piece: LegoPiece;
  connector: LegoConnector;
  world: THREE.Matrix4;
}

function resolveMount(
  module: LegoProject,
  pack: LoadedPack,
): ResolvedMount | null {
  if (!module.mount) return null;
  const piece = pieceById(module, module.mount.piece);
  if (!piece) return null;
  const connector = pieceConnectors(pack, piece).find(
    (c) => c.id === module.mount?.connector,
  );
  return connector
    ? { piece, connector, world: worldMatrix(module, piece.id) }
    : null;
}

/** The face of the parent a module is put on, and how it sits on it. */
export interface ModulePlacement extends PlaceOptions {
  /** The connector on the parent. */
  to: string;
}

/**
 * The connector of the module that joins when it is placed on `theirs`.
 *
 * A module with a mount joins by it, and `cycle` steps on through the connectors
 * of the mount's piece. A module without one (or whose mount no longer
 * resolves) joins by the connector of its first piece that faces most nearly
 * back at `theirs`, stepped on by `cycle`: the pick a part gets in `ownFace`.
 * Null when that piece has no connectors.
 */
function chooseMount(
  module: LegoProject,
  pack: LoadedPack,
  theirs: LegoConnector,
  cycle: number,
): ResolvedMount | null {
  const mounted = resolveMount(module, pack);
  const piece = mounted?.piece ?? pieceById(module, module.rootPieceId);
  if (!piece) return null;
  const own = pieceConnectors(pack, piece);
  if (own.length === 0) return null;
  let first = 0;
  if (mounted) {
    first = own.findIndex((c) => c.id === mounted.connector.id);
  } else {
    let lowest = Number.POSITIVE_INFINITY;
    own.forEach((connector, index) => {
      const dot =
        connector.facing[0] * theirs.facing[0] +
        connector.facing[1] * theirs.facing[1] +
        connector.facing[2] * theirs.facing[2];
      if (dot < lowest) {
        lowest = dot;
        first = index;
      }
    });
  }
  const connector =
    own[(((first + cycle) % own.length) + own.length) % own.length];
  return { piece, connector, world: worldMatrix(module, piece.id) };
}

/** `matrix` applied to a root's own transform, written back to the piece. */
function moved(piece: LegoPiece, matrix: THREE.Matrix4): LegoPiece {
  const own = new THREE.Matrix4().compose(
    new THREE.Vector3(...piece.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rotation)),
    new THREE.Vector3(...piece.scale),
  );
  return { ...piece, ...transformOf(matrix.clone().multiply(own)) };
}

/**
 * Add a module to a unit under `parentId`, with its mount on the parent.
 *
 * The mount goes on the parent's first free face. When the mount is on the
 * module's first piece, that piece is joined there and the join is saved. A
 * mount deeper in the module cannot be joined, because that piece's parent is
 * inside the module, so the whole module is moved to put the mount where the
 * join would have, and no join is saved.
 *
 * When the parent has no face to offer, the module is moved so its mount is at
 * the parent's origin. With no pack loaded, no mount, or a mount that does not
 * resolve, this is `insertCompound`.
 *
 * With a `placement`, the module joins that face of the parent instead of the
 * first free one, by the connector `chooseMount` picks, turned by the twist. A
 * module with no mount is then joined too, rather than left as it came.
 */
export function insertModule(
  project: LegoProject,
  module: LegoProject,
  parentId: string,
  newId: () => string,
  pack: LoadedPack | null,
  placement?: ModulePlacement,
): ReturnType<typeof insertCompound> {
  const inserted = insertCompound(project, module, parentId, newId);
  const parentKey = pieceById(project, parentId)
    ? parentId
    : project.rootPieceId;
  const parent = pieceById(inserted.project, parentKey);
  const theirs =
    pack && parent && placement
      ? pieceConnectors(pack, parent).find((c) => c.id === placement.to)
      : undefined;
  const mount =
    pack &&
    (placement
      ? theirs && chooseMount(module, pack, theirs, placement.cycle)
      : resolveMount(module, pack));
  if (!pack || !mount) return inserted;
  const mountId = inserted.idMap.get(mount.piece.id);
  if (!parent || !mountId) return inserted;

  const scale = new THREE.Vector3();
  mount.world.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  const face = placement ?? freeFace(project, pack, parent.id);
  const quarter = placement ? ((placement.twist % 4) + 4) % 4 : 0;
  const join = face && {
    connector: mount.connector.id,
    to: face.to,
    ...(quarter ? { twist: (quarter * Math.PI) / 2 } : {}),
  };
  // Where the mount piece goes under the parent for that join.
  const placed =
    join &&
    placeJoin(
      pack,
      {
        ...mount.piece,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: scale.toArray() as [number, number, number],
        connection: undefined,
      },
      parent,
      join,
      parentScaleOf(inserted.project, parent.id),
    );

  let shift: THREE.Matrix4;
  let joinTheFirst = false;
  if (join && placed) {
    shift = new THREE.Matrix4()
      .compose(
        new THREE.Vector3(...placed.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...placed.rotation),
        ),
        scale,
      )
      .multiply(mount.world.clone().invert());
    joinTheFirst = mount.piece.id === module.rootPieceId;
  } else {
    // The mount connector, in the module, lands on the parent's origin.
    const point = inModule(module, mount.piece, mount.connector);
    shift = new THREE.Matrix4().makeTranslation(-point.x, -point.y, -point.z);
  }

  const roots = new Set(inserted.rootPieceIds);
  const anchorId = inserted.rootPieceIds[0];
  const pieces = inserted.project.pieces.map((piece) => {
    if (!roots.has(piece.id)) return piece;
    const next = moved(piece, shift);
    return piece.id === anchorId && joinTheFirst && join
      ? { ...next, connection: join }
      : next;
  });
  return { ...inserted, project: { ...inserted.project, pieces } };
}

/**
 * A module added under the target's piece, joined to the face by its mount (or
 * the pick `chooseMount` makes without one). Null when the piece or its face is
 * missing, or the module has no connector to join by.
 */
export function placeModule(
  project: LegoProject,
  module: LegoProject,
  pack: LoadedPack,
  target: FaceTarget,
  options: PlaceOptions,
  newId: () => string,
): ReturnType<typeof insertCompound> | null {
  const parent = pieceById(project, target.parentId);
  if (!parent) return null;
  const theirs = pieceConnectors(pack, parent).find((c) => c.id === target.to);
  if (!theirs || !chooseMount(module, pack, theirs, options.cycle)) return null;
  return insertModule(project, module, parent.id, newId, pack, {
    ...options,
    to: target.to,
  });
}
