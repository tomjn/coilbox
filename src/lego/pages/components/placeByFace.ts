import * as THREE from "three";

import { pieceConnectors } from "../../connectors";
import {
  isEffectivelyHidden,
  type LegoProject,
  orderedPieces,
  pieceById,
} from "../../model";
import { placeModule } from "../../moduleMount";
import { getPartGeometry, type LegoPartInfo, partUnit } from "../../pack";
import { type FaceTarget, faceUnder, placePart } from "../../placePart";
import { getMeshGeometry } from "../../rawGeometry";
import { worldMatrix } from "../../reparent";
import { getShapeGeometry } from "../../shapes";
import type { Vec3 } from "../../snapping";
import { hitInPart } from "./anchorsAndSnapping";
import { chooseDropTarget, type DropTarget, groundSpot } from "./dragToPlace";
import { pieceIdOf } from "./gizmoCommit";
import { groundPoint } from "./measureLayer";
import type { SceneState } from "./sceneState";
import { aimFromPointer, pickViewAt } from "./viewLayout";

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

/**
 * The module's pieces drawn where placing it would put them, one translucent
 * mesh per piece with a part or a mesh. Returns whether anything was drawn.
 */
function showModuleGhost(
  state: SceneState,
  placing: PlacingModule,
  target: FaceTarget,
): boolean {
  const pack = state.packRef.current;
  const raw = state.rawRef.current;
  let count = 0;
  const out = placeModule(
    state.projectRef.current,
    placing.module,
    pack,
    target,
    placing,
    () => `${GHOST_ID}-${count++}`,
  );
  hideModuleGhost(state);
  state.placeGhost.visible = false;
  if (!out) return false;
  for (const piece of orderedPieces(placing.module)) {
    const placed = out.idMap.get(piece.id);
    // A lifted piece draws its mesh out of the unit's own geometry.
    const geometry = piece.partId
      ? getPartGeometry(pack, piece.partId)
      : piece.shape
        ? getShapeGeometry(piece.shape)
        : raw && piece.meshId
          ? getMeshGeometry(raw, piece.meshId)
          : null;
    if (!placed || !geometry) continue;
    const pivot = piece.pivot ?? [0, 0, 0];
    const mesh = new THREE.Mesh(geometry, state.placeGhost.material);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 2;
    mesh.raycast = () => {};
    mesh.matrix
      .copy(state.root.matrixWorld)
      .multiply(worldMatrix(out.project, placed))
      .multiply(
        new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]),
      );
    state.placeModuleGhost.add(mesh);
  }
  state.placeModuleGhost.visible = state.placeModuleGhost.children.length > 0;
  return state.placeModuleGhost.visible;
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

/** What a drag from the catalogue has over it, and where on the ground that is. */
export interface DragView {
  /** The pointer is at these window coordinates: draw the part where it would go. */
  aim(x: number, y: number): void;
  /** Where a drop at these window coordinates puts the part, or null for nowhere. */
  resolve(x: number, y: number): DropTarget | null;
  /** The drag is over: draw nothing. */
  clear(): void;
}

/**
 * Where a ray puts a part on the ground, in the root piece's axes, with the
 * step snapping gives it. Null without a ground under the ray or for a module.
 */
function groundDrop(
  state: SceneState,
  raycaster: THREE.Raycaster,
  placing: Placing,
): { position: Vec3; world: THREE.Matrix4 } | null {
  if ("module" in placing) return null;
  const at = groundPoint(state, raycaster);
  const geometry = getPartGeometry(state.packRef.current, placing.part.id);
  if (!at || !geometry) return null;
  const project = state.projectRef.current;
  const parent = state.root.matrixWorld
    .clone()
    .multiply(worldMatrix(project, project.rootPieceId));
  const local = new THREE.Vector3(...at).applyMatrix4(parent.clone().invert());
  geometry.computeBoundingBox();
  const lift = -(geometry.boundingBox?.min.y ?? 0);
  const position = groundSpot(
    [local.x, local.y, local.z],
    state.snapping ? partUnit(state.packRef.current) : null,
    lift,
  );
  return { position, world: parent };
}

/** The raycaster for a pointer at window coordinates, through the quadrant
 *  under it in four views, or null outside the viewport. */
function rayAt(state: SceneState, x: number, y: number) {
  const bounds = state.renderer.domElement.getBoundingClientRect();
  if (x < bounds.left || x > bounds.right) return null;
  if (y < bounds.top || y > bounds.bottom) return null;
  // A drag from the catalogue sends no pointer moves, so the quadrant is
  // picked here.
  if (pickViewAt(state, x, y)) state.render();
  const raycaster = new THREE.Raycaster();
  aimFromPointer(state, raycaster, x, y);
  return raycaster;
}

/** What a drop at these window coordinates would do. */
export function dropAt(
  state: SceneState,
  x: number,
  y: number,
): DropTarget | null {
  const placing = state.placingPartRef.current;
  const raycaster = rayAt(state, x, y);
  if (!placing || !raycaster) return null;
  const hit = firstPieceHit(state, raycaster);
  return chooseDropTarget({
    hitPiece: hit !== undefined,
    face: hit ? faceOfHit(state, hit) : null,
    ground: hit
      ? null
      : (groundDrop(state, raycaster, placing)?.position ?? null),
  });
}

/** Draw the part where a drop at these window coordinates would put it. */
export function aimDrag(state: SceneState, x: number, y: number) {
  const placing = state.placingPartRef.current;
  const raycaster = rayAt(state, x, y);
  const drop = dropAt(state, x, y);
  if (!placing || !raycaster || !drop) {
    if (state.placeTarget || state.placeGhost.visible) clearPlaceGhost(state);
    return;
  }
  if (drop.kind === "face") {
    hoverPlaceFace(state, firstPieceHit(state, raycaster));
    return;
  }
  const ground = groundDrop(state, raycaster, placing);
  const geometry =
    "part" in placing
      ? getPartGeometry(state.packRef.current, placing.part.id)
      : null;
  if (!ground || !geometry) return;
  state.placeTarget = null;
  state.placeMark.visible = false;
  hideModuleGhost(state);
  state.placeGhost.geometry = geometry;
  state.placeGhost.matrix
    .copy(ground.world)
    .multiply(new THREE.Matrix4().makeTranslation(...drop.position));
  state.placeGhost.matrixWorldNeedsUpdate = true;
  state.placeGhost.visible = true;
  state.render();
}
