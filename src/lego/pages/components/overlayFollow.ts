/**
 * Keeping the overlays on the pieces they are about while a script poses them.
 *
 * The overlay group follows the root, which is right for what belongs to the
 * whole unit: its collision volume and its aim point. The engine places those
 * from the object's own matrix alone (`CCollisionHandler::Intersect(o, v, m,
 * ...)`, `CollisionHandler.cpp:333-350`). A piece's volume is different: the
 * engine places it with the piece's model space matrix, so it turns and moves
 * with the piece (`IntersectPiecesHelper`, `CollisionHandler.cpp:281-282`).
 *
 * So nothing is moved into the piece tree, where picking, bounding boxes and
 * framing would read it. Each piece box gets a matrix worked out from the
 * piece's world matrix after the script posed it.
 */

import * as THREE from "three";
import type { SceneState } from "./sceneState";

const ROOT_INVERSE = new THREE.Matrix4();
const DELTA = new THREE.Matrix4();
const BACK = new THREE.Matrix4();
const OWN = new THREE.Matrix4();
const NO_TURN = new THREE.Quaternion();

/**
 * Sit a wash mesh over a piece's own faces, not its bounding box, by pointing
 * it at the same geometry as the piece's mesh and copying that mesh's local
 * transform. The geometry is a borrowed reference: it belongs to the pack's
 * shared cache or, while playing, to the bake, and this mesh must never
 * dispose it.
 *
 * A piece with no part (an empty hierarchy node) has no mesh to trace, so
 * there is nothing to wash and the overlay is hidden instead.
 */
export function showOverlay(overlay: THREE.Mesh, group: THREE.Group) {
  const mesh = group.children.find((child) => child instanceof THREE.Mesh) as
    | THREE.Mesh
    | undefined;
  if (!mesh) {
    hideOverlay(overlay);
    return;
  }
  overlay.geometry = mesh.geometry;
  overlay.position.copy(mesh.position);
  overlay.rotation.copy(mesh.rotation);
  overlay.scale.copy(mesh.scale);
  group.add(overlay);
  overlay.visible = true;
}

export function hideOverlay(overlay: THREE.Mesh) {
  overlay.visible = false;
}

/** Where a piece box was built, set when it is made: the piece's own place in
 *  the model, which is what a box's offsets are measured from. */
export function boxOrigin(box: THREE.Object3D): THREE.Vector3 | undefined {
  return box.userData.origin as THREE.Vector3 | undefined;
}

/**
 * Put the selection's and the hover's boxes and face washes on the pieces where
 * they now are. The boxes are world boxes, measured once when the piece was
 * picked, and a wash copies its mesh's shape when it is made, which playback
 * changes by baking.
 */
export function refreshSelection(state: SceneState) {
  state.root.updateMatrixWorld(true);
  state.selectedGroups.forEach((group, index) => {
    state.selectOutlines[index]?.setFromObject(group);
    const wash = state.selectOverlays[index];
    if (wash) showOverlay(wash, group);
  });
  const hovered = state.hoveredId ? state.groups.get(state.hoveredId) : null;
  if (hovered && state.hoverOutline.visible) {
    state.hoverOutline.setFromObject(hovered);
    showOverlay(state.hoverOverlay, hovered);
  }
}

/** Carry each piece's collision box with its piece, from wherever the script
 *  has posed the piece, and the selection with it. */
export function followPieces(state: SceneState) {
  refreshSelection(state);
  ROOT_INVERSE.copy(state.root.matrixWorld).invert();
  for (const [pieceId, box] of state.pieceCollisionBoxes) {
    const group = state.groups.get(pieceId);
    const origin = boxOrigin(box);
    if (!group || !origin) continue;
    // The engine skips a piece the script hides when it tests the volumes
    // (`IntersectPiecesHelper` checks `GetScriptVisible()`), so its box goes
    // with it. The piece's mesh carries the flag, as in `applyTimelineFrame`.
    const mesh = group.children.find((child) => child instanceof THREE.Mesh);
    box.visible = mesh?.visible ?? true;
    // The piece's move from where the box was built, in the root's space:
    // where it is now, taken back through where it was.
    BACK.makeTranslation(-origin.x, -origin.y, -origin.z);
    DELTA.multiplyMatrices(ROOT_INVERSE, group.matrixWorld).multiply(BACK);
    OWN.compose(box.position, NO_TURN, box.scale);
    box.matrixAutoUpdate = false;
    box.matrix.multiplyMatrices(DELTA, OWN);
    box.matrixWorldNeedsUpdate = true;
  }
}

/** Hand the piece boxes back to their own position and scale, which editing
 *  and the size handles read and write. */
export function releasePieces(state: SceneState) {
  for (const box of state.pieceCollisionBoxes.values()) {
    box.matrixAutoUpdate = true;
    box.matrixWorldNeedsUpdate = true;
    box.visible = true;
  }
}
