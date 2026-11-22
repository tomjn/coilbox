import * as THREE from "three";

import { pieceConnectors } from "../../connectors";
import {
  isEffectivelyHidden,
  type LegoPiece,
  type LegoProject,
  orderedPieces,
  pieceById,
} from "../../model";
import { placeModule, placeModuleAt } from "../../moduleMount";
import { getPartGeometry, type LegoPartInfo, partUnit } from "../../pack";
import { newShape } from "../../addShape";
import { type FaceTarget, faceUnder, placePart } from "../../placePart";
import { getMeshGeometry } from "../../rawGeometry";
import { worldMatrix } from "../../reparent";
import { getShapeGeometry, type ShapeKind } from "../../shapes";
import type { Vec3 } from "../../snapping";
import { hitInPart } from "./anchorsAndSnapping";
import {
  chooseDropTarget,
  type DropTarget,
  groundSpot,
  type Spot,
  surfaceSpot,
} from "./dragToPlace";
import { pieceIdOf } from "./gizmoCommit";
import { groundPoint } from "./measureLayer";
import type { SceneState } from "./sceneState";

/** A part waiting to be put on a face, and how it will sit when it is. */
export interface PlacingPart {
  part: LegoPartInfo;
  /** Steps through the part's own faces, from the one facing the target. */
  cycle: number;
  /** Quarter turns about the joined face. */
  twist: number;
}

/** A module waiting to be put on a face. It joins by its mount, or without
 *  one by the face of its first piece that faces the target. */
export interface PlacingModule {
  module: LegoProject;
  cycle: number;
  twist: number;
}

/** What is waiting for a face: a part from the strip or a module. */
export type Placing = PlacingPart | PlacingModule;

/** A shape being dragged in. It has no placing mode, because a click adds it
 *  where the selection is, so it is only ever held by a drag. */
export interface DraggedShape {
  shape: ShapeKind;
}

/** What a drag from the catalogue carries. */
export type DragSubject = Placing | DraggedShape;

/** The id the ghost's piece has while the document is asked where it goes. */
const GHOST_ID = "place-ghost";

/** The first visible piece the ray hits. */
export function firstPieceHit(
  state: SceneState,
  raycaster: THREE.Raycaster,
): THREE.Intersection | undefined {
  for (const hit of raycaster.intersectObject(state.root, true)) {
    const id = pieceIdOf(hit.object);
    if (id && !isEffectivelyHidden(state.projectRef.current, id)) return hit;
  }
  return undefined;
}

/** The connector a hit is on, or null where the hit is on no face. */
export function faceOfHit(
  state: SceneState,
  hit: THREE.Intersection | undefined,
): FaceTarget | null {
  const inPart = hitInPart(state, hit);
  if (!inPart?.facing) return null;
  const piece = pieceById(state.projectRef.current, inPart.pieceId);
  if (!piece) return null;
  const face = faceUnder(
    state.packRef.current,
    piece,
    inPart.position,
    inPart.facing,
  );
  return face ? { parentId: piece.id, to: face.id } : null;
}

/** Where the pointer is now, so the ghost can follow it. */
export function hoverPlaceFace(
  state: SceneState,
  hit: THREE.Intersection | undefined,
) {
  const target = faceOfHit(state, hit);
  const was = state.placeTarget;
  state.placeTarget = target;
  if (was?.parentId === target?.parentId && was?.to === target?.to) return;
  showPlaceGhost(state);
  state.render();
}

/** Stop placing: nothing is aimed at and nothing is drawn. */
export function clearPlaceGhost(state: SceneState) {
  state.placeTarget = null;
  state.placeGhost.visible = false;
  state.placeMark.visible = false;
  hideModuleGhost(state);
  state.render();
}

function hideModuleGhost(state: SceneState) {
  state.placeModuleGhost.visible = false;
  state.placeModuleGhost.clear();
}

/** The geometry a piece of a module draws, or null for one that draws none. */
function moduleGeometry(state: SceneState, piece: LegoPiece) {
  const pack = state.packRef.current;
  const raw = state.rawRef.current;
  // A lifted piece draws its mesh out of the unit's own geometry.
  return piece.partId
    ? getPartGeometry(pack, piece.partId)
    : piece.shape
      ? getShapeGeometry(piece.shape)
      : raw && piece.meshId
        ? getMeshGeometry(raw, piece.meshId)
        : null;
}

/** The matrix a placed piece of a module is drawn with, geometry and all. */
function placedMatrix(
  state: SceneState,
  project: LegoProject,
  pieceId: string,
  pivot: Vec3,
) {
  return state.root.matrixWorld
    .clone()
    .multiply(worldMatrix(project, pieceId))
    .multiply(
      new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]),
    );
}

/**
 * The module's pieces drawn where `out` put them, one translucent mesh per
 * piece with a part or a mesh. Returns whether anything was drawn.
 */
function drawModuleGhost(
  state: SceneState,
  module: LegoProject,
  out: { project: LegoProject; idMap: Map<string, string> },
): boolean {
  hideModuleGhost(state);
  state.placeGhost.visible = false;
  for (const piece of orderedPieces(module)) {
    const placed = out.idMap.get(piece.id);
    const geometry = moduleGeometry(state, piece);
    if (!placed || !geometry) continue;
    const mesh = new THREE.Mesh(geometry, state.placeGhost.material);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 2;
    mesh.raycast = () => {};
    mesh.matrix.copy(
      placedMatrix(state, out.project, placed, piece.pivot ?? [0, 0, 0]),
    );
    state.placeModuleGhost.add(mesh);
  }
  state.placeModuleGhost.visible = state.placeModuleGhost.children.length > 0;
  return state.placeModuleGhost.visible;
}

/** The lowest point of a module's pieces as `out` put them, in the world, or
 *  null when none of them draws anything. */
function placedFloor(
  state: SceneState,
  module: LegoProject,
  out: { project: LegoProject; idMap: Map<string, string> },
): number | null {
  let floor: number | null = null;
  for (const piece of orderedPieces(module)) {
    const placed = out.idMap.get(piece.id);
    const geometry = moduleGeometry(state, piece);
    if (!placed || !geometry) continue;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) continue;
    const matrix = placedMatrix(
      state,
      out.project,
      placed,
      piece.pivot ?? [0, 0, 0],
    );
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const at = new THREE.Vector3(x, y, z).applyMatrix4(matrix).y;
          if (floor === null || at < floor) floor = at;
        }
  }
  return floor;
}

/**
 * The module's pieces drawn where placing it would put them, one translucent
 * mesh per piece with a part or a mesh. Returns whether anything was drawn.
 */
function showModuleGhost(
  state: SceneState,
  placing: PlacingModule,
  target: FaceTarget,
): boolean {
  let count = 0;
  const out = placeModule(
    state.projectRef.current,
    placing.module,
    state.packRef.current,
    target,
    placing,
    () => `${GHOST_ID}-${count++}`,
  );
  if (!out) {
    hideModuleGhost(state);
    state.placeGhost.visible = false;
    return false;
  }
  return drawModuleGhost(state, placing.module, out);
}

/** Draw the part or module where its target would put it, or nothing without one. */
export function showPlaceGhost(state: SceneState) {
  const placing = state.placingPartRef.current;
  const target = state.placeTarget;
  const pack = state.packRef.current;
  const project = state.projectRef.current;
  const parent = target ? pieceById(project, target.parentId) : undefined;
  const group = target ? state.groups.get(target.parentId) : undefined;
  const face = parent
    ? pieceConnectors(pack, parent).find((c) => c.id === target?.to)
    : undefined;
  const drawn =
    placing && target && parent && group && face
      ? "module" in placing
        ? showModuleGhost(state, placing, target)
        : showPartGhost(state, placing, target)
      : false;
  if (!drawn || !parent || !group || !face) {
    state.placeGhost.visible = false;
    state.placeMark.visible = false;
    hideModuleGhost(state);
    return;
  }

  // A dot at the middle of the face the part will sit on.
  const pivot = parent.pivot ?? [0, 0, 0];
  group.updateWorldMatrix(true, false);
  state.placeMark.position
    .set(
      face.position[0] - pivot[0],
      face.position[1] - pivot[1],
      face.position[2] - pivot[2],
    )
    .applyMatrix4(group.matrixWorld);
  state.placeMark.visible = true;
}

function showPartGhost(
  state: SceneState,
  placing: PlacingPart,
  target: FaceTarget,
): boolean {
  const pack = state.packRef.current;
  const next = placePart(
    state.projectRef.current,
    pack,
    placing.part,
    target,
    placing,
    GHOST_ID,
  );
  const geometry = getPartGeometry(pack, placing.part.id);
  if (!next || !geometry) return false;
  hideModuleGhost(state);
  state.placeGhost.geometry = geometry;
  state.placeGhost.matrix
    .copy(state.root.matrixWorld)
    .multiply(worldMatrix(next, GHOST_ID));
  state.placeGhost.matrixWorldNeedsUpdate = true;
  state.placeGhost.visible = true;
  return true;
}

/**
 * A click while placing. A face puts the part there. A click that hit nothing
 * is told to the page as no target, which is how an empty unit takes its first
 * part. A hit on something with no face under it does nothing.
 */
export function placeOnClick(
  state: SceneState,
  hit: THREE.Intersection | undefined,
) {
  if (!hit) {
    state.onPlacePartRef.current?.(null);
    return;
  }
  const target = faceOfHit(state, hit);
  if (target) state.onPlacePartRef.current?.(target);
}

/** What a drag from the catalogue is carrying, and where a ground drop hangs. */
export interface DragAim {
  /** The tile being dragged, or null while it is not ready to be placed. */
  subject: DragSubject | null;
  /** The piece a drop on the ground attaches to: the selected piece or the root. */
  parentId: string;
}

/** What a drag from the catalogue has over it, and where on the ground that is. */
export interface DragView {
  /** The pointer is at these window coordinates: draw the tile where it would go. */
  aim(x: number, y: number, drag: DragAim): void;
  /** Where a drop at these window coordinates puts the tile, or null for nowhere. */
  resolve(x: number, y: number, drag: DragAim): DropTarget | null;
  /** The drag is over: draw nothing. */
  clear(): void;
}

/** The numbers a dragged shape would be added with, or null with no pack. */
function draggedShape(state: SceneState, shape: ShapeKind) {
  return newShape(state.projectRef.current, shape, state.packRef.current);
}

/** The matrix of a piece's own axes in the world, which places hang from. */
function parentFrame(state: SceneState, parentId: string): THREE.Matrix4 {
  const project = state.projectRef.current;
  const id = pieceById(project, parentId) ? parentId : project.rootPieceId;
  return state.root.matrixWorld.clone().multiply(worldMatrix(project, id));
}

/** The geometry a dragged part or shape draws, or null for a module. */
function subjectGeometry(
  state: SceneState,
  subject: DragSubject,
): THREE.BufferGeometry | null {
  if ("module" in subject) return null;
  if ("part" in subject)
    return getPartGeometry(state.packRef.current, subject.part.id);
  const made = draggedShape(state, subject.shape);
  return made ? getShapeGeometry(made) : null;
}

/**
 * Where a ray puts a tile on the ground, in the parent piece's axes, with the
 * step snapping gives it and the lift that stands it on the ground. Null where
 * the ray misses the ground or there is nothing to draw.
 */
function groundDrop(
  state: SceneState,
  raycaster: THREE.Raycaster,
  subject: DragSubject,
  parentId: string,
): Vec3 | null {
  const at = groundPoint(state, raycaster);
  if (!at) return null;
  const project = state.projectRef.current;
  const owner = pieceById(project, parentId) ? parentId : project.rootPieceId;
  const local = new THREE.Vector3(...at).applyMatrix4(
    parentFrame(state, owner).invert(),
  );
  const step = state.snapping ? partUnit(state.packRef.current) : null;
  const spot: Vec3 = [local.x, local.y, local.z];

  if ("module" in subject) {
    const flat = groundSpot(spot, step, 0);
    const out = placeModuleAt(project, subject.module, owner, flat, () =>
      crypto.randomUUID(),
    );
    const floor = out ? placedFloor(state, subject.module, out) : null;
    return [flat[0], flat[1] + (floor === null ? 0 : at[1] - floor), flat[2]];
  }

  const geometry = subjectGeometry(state, subject);
  if (!geometry) return null;
  geometry.computeBoundingBox();
  return groundSpot(spot, step, -(geometry.boundingBox?.min.y ?? 0));
}

/**
 * Where a shape dropped on a piece rests: on the point under the pointer, put
 * out along the surface's normal by half the shape's reach. Null when the hit
 * has no surface to measure.
 */
function surfaceDrop(
  state: SceneState,
  hit: THREE.Intersection,
  shape: ShapeKind,
): Spot | null {
  const pieceId = pieceIdOf(hit.object);
  const made = draggedShape(state, shape);
  if (!pieceId || !made || !hit.face) return null;
  const inverse = parentFrame(state, pieceId).invert();
  const point = hit.point.clone().applyMatrix4(inverse);
  const normal = hit.face.normal
    .clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
    .normalize()
    .transformDirection(inverse);
  return {
    parentId: pieceId,
    position: surfaceSpot(
      [point.x, point.y, point.z],
      [normal.x, normal.y, normal.z],
      made.size,
    ),
  };
}

/** The raycaster for a pointer at window coordinates, or null outside the viewport. */
function rayAt(state: SceneState, x: number, y: number) {
  const bounds = state.renderer.domElement.getBoundingClientRect();
  if (x < bounds.left || x > bounds.right) return null;
  if (y < bounds.top || y > bounds.bottom) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      ((x - bounds.left) / bounds.width) * 2 - 1,
      -((y - bounds.top) / bounds.height) * 2 + 1,
    ),
    state.camera,
  );
  return raycaster;
}

/** What a drop at these window coordinates would do. */
export function dropAt(
  state: SceneState,
  x: number,
  y: number,
  drag: DragAim,
): DropTarget | null {
  const raycaster = rayAt(state, x, y);
  if (!drag.subject || !raycaster) return null;
  const hit = firstPieceHit(state, raycaster);
  const shape = "shape" in drag.subject ? drag.subject.shape : null;
  const ground =
    hit === undefined
      ? groundDrop(state, raycaster, drag.subject, drag.parentId)
      : null;
  return chooseDropTarget({
    hitPiece: hit !== undefined,
    face: hit && !shape ? faceOfHit(state, hit) : null,
    ground: ground && { parentId: drag.parentId, position: ground },
    surface: hit && shape ? surfaceDrop(state, hit, shape) : null,
  });
}

/** Draw a tile's geometry at a place in a parent's axes, in place of the face ghost. */
function showSpotGhost(
  state: SceneState,
  geometry: THREE.BufferGeometry,
  world: THREE.Matrix4,
  position: Vec3,
) {
  state.placeTarget = null;
  state.placeMark.visible = false;
  hideModuleGhost(state);
  state.placeGhost.geometry = geometry;
  state.placeGhost.matrix
    .copy(world)
    .multiply(new THREE.Matrix4().makeTranslation(...position));
  state.placeGhost.matrixWorldNeedsUpdate = true;
  state.placeGhost.visible = true;
  state.render();
}

/** Draw the tile where a drop at these window coordinates would put it. */
export function aimDrag(
  state: SceneState,
  x: number,
  y: number,
  drag: DragAim,
) {
  const raycaster = rayAt(state, x, y);
  const drop = dropAt(state, x, y, drag);
  const subject = drag.subject;
  if (!subject || !raycaster || !drop) {
    if (state.placeTarget || state.placeGhost.visible) clearPlaceGhost(state);
    return;
  }
  if (drop.kind === "face") {
    hoverPlaceFace(state, firstPieceHit(state, raycaster));
    return;
  }
  const world = parentFrame(state, drop.parentId);
  if ("module" in subject) {
    const out = placeModuleAt(
      state.projectRef.current,
      subject.module,
      drop.parentId,
      drop.position,
      () => crypto.randomUUID(),
    );
    if (!out || !drawModuleGhost(state, subject.module, out)) return;
    state.placeTarget = null;
    state.placeMark.visible = false;
    state.render();
    return;
  }
  const geometry = subjectGeometry(state, subject);
  if (geometry) showSpotGhost(state, geometry, world, drop.position);
}
