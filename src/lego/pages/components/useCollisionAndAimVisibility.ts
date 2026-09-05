import { type RefObject, useEffect } from "react";
import { aimPoint } from "../../aimPoint";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { unitBounds } from "../../s3oBuild";
import { showCollisionHandles } from "./collisionHandles";
import {
  attachGizmo,
  COLLISION_DIM_OPACITY,
  COLLISION_OPACITY,
  COLLISION_OVERLAY_OPACITY,
  type SceneState,
  SELECT_OVERLAY_OPACITY,
  showCollisionVolume,
  showPieceCollisionVolumes,
} from "./ModelViewport";

export interface CollisionAndAimVisibilityDeps {
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  showCollision: boolean;
  editCollision: boolean;
  editingVolume: boolean;
  editPieceCollisionId: string | null;
  showAim: boolean;
  showAimPoint: boolean;
  selectedIdsRef: RefObject<string[]>;
  placingAnchorRef: RefObject<boolean>;
}

/**
 * Draw the collision volume, the per-piece boxes and the aim point, and point
 * the gizmo at whichever of them a panel has open.
 *
 * The two effects stay together because both decide what the gizmo attaches
 * to next, in the same order they ran in before this hook existed: the
 * collision and piece boxes first, the aim point after.
 */
export function useCollisionAndAimVisibility(
  sceneRef: RefObject<SceneState | null>,
  {
    project,
    pack,
    raw,
    showCollision,
    editCollision,
    editingVolume,
    editPieceCollisionId,
    showAim,
    showAimPoint,
    selectedIdsRef,
    placingAnchorRef,
  }: CollisionAndAimVisibilityDeps,
) {
  // Before the gizmo below, which may have to point at what this builds.
  // Follows the document as well as the toggle: the derived volume is the
  // unit's own bounding box, so it changes every time a piece does.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.editCollision = editCollision;
    state.editPieceId = editPieceCollisionId;
    const shown = showCollision || editCollision;
    // Both boxes are wireframes read through the model, so the model's own
    // washes step back while either panel is open.
    state.selectOverlayMaterial.opacity =
      editingVolume || showAimPoint
        ? COLLISION_OVERLAY_OPACITY
        : SELECT_OVERLAY_OPACITY;
    showCollisionVolume(state, shown ? project : null, pack, raw);
    // One set of boxes for both switches: the engine builds them once and
    // hit-tests and click-tests against the same tree, so either switch alone
    // is reason to draw them.
    //
    // Picking a piece to edit draws them whichever way the switches are set,
    // the same way opening the collision panel draws the unit's own volume. A
    // piece can be given a box before the unit is told to use them, and handles
    // for a shape nobody can see would be handles on nothing.
    showPieceCollisionVolumes(
      state,
      (shown && (project.pieceCollision || project.pieceSelection)) ||
        editPieceCollisionId !== null
        ? project
        : null,
      pack,
      raw,
    );
    // The unit's volume steps back once a piece's box is the shape being
    // changed, so the large orange box drawn over everything stops winning the
    // eye against the small yellow one inside it. After the boxes, since a
    // piece nothing hits draws none and keeps the volume the shape being read.
    state.collisionMaterial.opacity =
      editPieceCollisionId !== null &&
      state.pieceCollisionBoxes.has(editPieceCollisionId)
        ? COLLISION_DIM_OPACITY
        : COLLISION_OPACITY;
    // The handles move between the volume and the selected piece with this, so
    // they are re-pointed here rather than left until the selection changes.
    attachGizmo(
      state,
      project,
      selectedIdsRef.current,
      placingAnchorRef.current,
    );
    showCollisionHandles(state);
    state.render();
  }, [
    sceneRef,
    showCollision,
    editCollision,
    editingVolume,
    editPieceCollisionId,
    showAimPoint,
    project,
    pack,
    raw,
    selectedIdsRef,
    placingAnchorRef,
  ]);

  // Follows the document as well as the toggle, for the same reason the volume
  // does: a unit that has not been given an aim point is aimed at the middle of
  // its own bounding box, which moves every time a piece does.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const shown = showAim || showAimPoint;
    state.aimMark.visible = shown;
    // Handles only while the panel that explains them is open, which is the
    // same rule the collision volume follows. The viewport's own toggle draws
    // the point without offering to move it.
    state.editAim = showAimPoint;
    if (shown) {
      state.aimMark.position.set(
        ...aimPoint(project, unitBounds(project, pack, raw)),
      );
    }
    // After the position, so the gizmo attaches to a marker already sitting
    // where the point is rather than snapping to it on the next frame.
    attachGizmo(
      state,
      project,
      selectedIdsRef.current,
      placingAnchorRef.current,
    );
    state.render();
  }, [
    sceneRef,
    showAim,
    showAimPoint,
    project,
    pack,
    raw,
    selectedIdsRef,
    placingAnchorRef,
  ]);
}
