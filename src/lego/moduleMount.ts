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
import { freeFace } from "./placePart";
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
 * resolve, this is `insertCompound`, and `asModule` is passed to it.
 */
export function insertModule(
  project: LegoProject,
  module: LegoProject,
  parentId: string,
  newId: () => string,
  pack: LoadedPack | null,
  asModule = false,
): ReturnType<typeof insertCompound> {
  const inserted = insertCompound(project, module, parentId, newId, asModule);
  const mount = pack && resolveMount(module, pack);
  if (!pack || !mount) return inserted;

  const parentKey = pieceById(project, parentId)
    ? parentId
    : project.rootPieceId;
  const parent = pieceById(inserted.project, parentKey);
  const mountId = inserted.idMap.get(mount.piece.id);
  if (!parent || !mountId) return inserted;

  const scale = new THREE.Vector3();
  mount.world.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  const face = freeFace(project, pack, parent.id);
  const join = face && { connector: mount.connector.id, to: face.to };
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
