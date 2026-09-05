import * as THREE from "three";

import { isEffectivelyHidden, type LegoProject } from "../../model";
import { ORIGIN_COLOUR } from "./ModelViewport";
import type { SceneState } from "./sceneState";

/**
 * A flat, unlit tint for the hover and selection washes.
 *
 * `polygonOffset` pulls the wash slightly forward in the depth buffer without
 * moving a vertex, which is what stops it z-fighting with the very surface it
 * sits on. `depthWrite` stays off so it never itself occludes anything drawn
 * after it.
 */
export function overlayMaterial(
  colour: number,
  opacity: number,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

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
function showOverlay(overlay: THREE.Mesh, group: THREE.Group) {
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

function hideOverlay(overlay: THREE.Mesh) {
  overlay.visible = false;
}

/**
 * Draw a violet box and face wash on every selected piece.
 *
 * A hidden piece is left out: its row stays selectable so it can be unhidden,
 * but there is nothing on screen to draw a box round. The pools are only ever
 * grown, so selecting eight pieces and then one leaves seven idle helpers
 * rather than seven disposed and rebuilt on the next click.
 */
export function showSelection(
  state: SceneState,
  project: LegoProject,
  selectedIds: string[],
) {
  const groups = selectedIds
    .filter((id) => !isEffectivelyHidden(project, id))
    .map((id) => state.groups.get(id))
    .filter((group): group is THREE.Group => group !== undefined);
  state.selectedGroups = groups;

  while (state.selectOutlines.length < groups.length) {
    const helper = new THREE.BoxHelper(state.root, ORIGIN_COLOUR);
    helper.visible = false;
    state.scene.add(helper);
    state.selectOutlines.push(helper);
  }
  while (state.selectOverlays.length < groups.length) {
    const overlay = new THREE.Mesh(
      new THREE.BufferGeometry(),
      state.selectOverlayMaterial,
    );
    overlay.visible = false;
    overlay.raycast = () => {};
    state.selectOverlays.push(overlay);
  }

  state.selectOutlines.forEach((helper, index) => {
    const group = groups[index];
    if (group) helper.setFromObject(group);
    helper.visible = group !== undefined;
  });
  state.selectOverlays.forEach((overlay, index) => {
    const group = groups[index];
    // `showOverlay` adds the wash to the piece's own group, which takes it off
    // whichever group had it before.
    if (group) showOverlay(overlay, group);
    else hideOverlay(overlay);
  });
}

/** Keep the boxes on the pieces while a drag moves them. */
export function refreshSelectionOutlines(state: SceneState) {
  state.selectedGroups.forEach((group, index) => {
    state.selectOutlines[index]?.setFromObject(group);
  });
}

/**
 * Resolve what should count as hovered, apply the outline and wash for it,
 * and report the result back to whichever raycast or pointer event asked.
 *
 * Split from `applyHoveredId` because a change coming from the `hoveredId`
 * prop (the sidebar tree hovering a row) must not itself call back out through
 * `onHoverRef`: that would immediately overwrite the tree's own hover state,
 * most visibly for a hidden piece, which resolves to nothing here but is still
 * exactly what the tree row is hovering.
 */
export function setHoveredAndNotify(state: SceneState, pieceId: string | null) {
  const previous = state.hoveredId;
  const resolved = applyHoveredId(state, pieceId);
  if (resolved !== previous) state.onHoverRef.current?.(resolved);
}

/**
 * Resolve, store and draw the hovered piece, without notifying anyone.
 *
 * A hidden piece (or one behind a hidden ancestor) resolves to nothing: there
 * is nothing on screen to point at, so there is nothing to hover.
 */
function applyHoveredId(
  state: SceneState,
  pieceId: string | null,
): string | null {
  const resolved = resolveHovered(state.projectRef.current, pieceId);
  if (resolved !== state.hoveredId) {
    state.hoveredId = resolved;
    applyHoverVisual(state);
    state.render();
  }
  return resolved;
}

/** Never a hidden piece, or one behind a hidden ancestor: there is nothing on
 *  screen for either of those to point at. */
export function resolveHovered(
  project: LegoProject,
  pieceId: string | null,
): string | null {
  return pieceId && !isEffectivelyHidden(project, pieceId) ? pieceId : null;
}

/**
 * Draw (or clear) the hover outline and wash for whatever `state.hoveredId` is
 * now. A selected piece is skipped even if it is also the hovered one: its own
 * outline, wash and gizmo already say enough, and a second wash in a different
 * colour on the same faces would only look muddy.
 */
export function applyHoverVisual(state: SceneState) {
  const id = state.hoveredId;
  const group =
    id && !state.selectedIdsRef.current.includes(id)
      ? state.groups.get(id)
      : undefined;
  if (group) {
    state.hoverOutline.setFromObject(group);
    state.hoverOutline.visible = true;
    showOverlay(state.hoverOverlay, group);
  } else {
    state.hoverOutline.visible = false;
    hideOverlay(state.hoverOverlay);
  }
}
