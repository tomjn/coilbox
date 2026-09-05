import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

import { aimPoint } from "../../aimPoint";
import {
  effectiveCollisionVolume,
  engineScales,
  pieceCollisionVolumes,
} from "../../collisionVolume";
import type { LegoCollisionVolume, LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { bakedPieces, unitBounds } from "../../s3oBuild";
import type { SceneState } from "./sceneState";

/**
 * Draw the collision volume the export would write, or take it away again.
 *
 * The volume is positioned from the unit's aim point, because that is where the
 * engine measures its offsets from, so what is drawn sits exactly where it will
 * in a game. On most units the aim point is the middle of the bounding box and
 * a volume with no offset sits on it.
 *
 * A null project means "not showing", which is also what leaves nothing behind
 * to keep in step with the document.
 *
 * The shape is built one elmo across and the object carries its size, so the
 * volume's own numbers are the object's transform and a drag needs no
 * conversion to read back.
 */
export function showCollisionVolume(
  state: SceneState,
  project: LegoProject | null,
  pack: LoadedPack,
  raw: RawGeometry | null,
) {
  if (state.collision) {
    if (state.gizmo.object === state.collision) state.gizmo.detach();
    state.collision.geometry.dispose();
    state.collision.removeFromParent();
    state.collision = null;
  }
  if (!project) return;

  const bounds = unitBounds(project, pack, raw);
  const aim = aimPoint(project, bounds);
  const volume = effectiveCollisionVolume(project, bounds);
  const lines = new THREE.LineSegments(
    collisionWireframe(volume),
    state.collisionMaterial,
  );
  lines.position.set(
    aim[0] + volume.offsets[0],
    aim[1] + volume.offsets[1],
    aim[2] + volume.offsets[2],
  );
  lines.scale.set(...engineScales(volume));
  // Over the model, to match the material's own `depthTest: false`.
  lines.renderOrder = 4;
  lines.raycast = () => {};
  state.collision = lines;
  state.scene.add(lines);
}

/**
 * Draw the box the engine will hit on each piece, or take them away again.
 *
 * Mostly a reading: nothing in a model or a unit definition declares these, the
 * engine measures one off every piece's vertices as it loads the model, and the
 * unit definition only chooses whether to hit them. Drawing them is the only way
 * to see what a shot will meet before the unit is in a game.
 *
 * A piece given a box of its own draws that one instead, and a piece switched
 * out of the hit test draws nothing, because nothing is what it will stop. Both
 * come out of `pieceCollisionVolumes`, so the shape on screen is the shape the
 * generated collision file sets. See `pieceCollisionScript.ts`.
 *
 * A null project means "not showing", which covers both the toggle being off
 * and the unit not asking for piece collision.
 *
 * The piece being edited is drawn wide and the rest thin. Every box used to be
 * one faint colour, which left the one you had picked indistinguishable from
 * the thirty behind it, so a unit with any real number of pieces read as a mesh
 * of lines rather than as a box you were changing.
 */
export function showPieceCollisionVolumes(
  state: SceneState,
  project: LegoProject | null,
  pack: LoadedPack,
  raw: RawGeometry | null,
) {
  disposePieceCollision(state);
  if (!project) return;

  const { pieces } = bakedPieces(project, pack, raw);
  const group = new THREE.Group();
  for (const { pieceId, origin, volume, hit } of pieceCollisionVolumes(
    project,
    pieces,
  )) {
    if (!hit) continue;
    const edited = pieceId === state.editPieceId;
    const wire = collisionWireframe(volume);
    let lines: THREE.Object3D;
    if (edited) {
      // `LineSegments2` keeps its own copy of the points as instance
      // attributes, so the wireframe it was built from is finished with here.
      // Fed by position rather than by `fromEdgesGeometry`, which is typed for
      // an `EdgesGeometry` and a round volume's wireframe is not one.
      const fat = new LineSegmentsGeometry().setPositions(
        wire.attributes.position.array as Float32Array,
      );
      wire.dispose();
      lines = new LineSegments2(fat, state.pieceEditMaterial);
    } else {
      lines = new THREE.LineSegments(wire, state.pieceCollisionMaterial);
    }
    lines.position.set(
      origin[0] + volume.offsets[0],
      origin[1] + volume.offsets[1],
      origin[2] + volume.offsets[2],
    );
    // What the engine will build rather than what was typed, the same way the
    // unit volume is drawn: `FixTypeAndScale` makes a sphere uniform and a
    // cylinder round whatever the numbers say.
    lines.scale.set(...engineScales(volume));
    // Above the crowd of thin boxes, so the edited one is not cut into by a
    // box drawn after it.
    lines.renderOrder = edited ? 5 : 4;
    lines.raycast = () => {};
    group.add(lines);
    state.pieceCollisionBoxes.set(pieceId, lines);
  }
  state.pieceCollision = group;
  state.scene.add(group);
}

/** Free the per-piece boxes. Each carries its own geometry, and they share the
 *  two materials, which outlive them. */
export function disposePieceCollision(state: SceneState) {
  state.pieceCollisionBoxes.clear();
  if (!state.pieceCollision) return;
  for (const lines of state.pieceCollision.children) {
    if (state.gizmo.object === lines) state.gizmo.detach();
    (lines as THREE.LineSegments | LineSegments2).geometry.dispose();
  }
  state.pieceCollision.removeFromParent();
  state.pieceCollision = null;
}

/**
 * A volume as lines, one elmo across, in the shape the engine will actually
 * build. A sphere written with three different sizes is drawn round, and a
 * cylinder written with an oval cross-section is drawn circular, because that
 * is what a game gets: see `engineScales`.
 *
 * A box and a cylinder are drawn as their edges, which is the outline you would
 * draw by hand. A sphere has no edges to find, so that one is the full mesh
 * wireframe.
 */
function collisionWireframe(volume: LegoCollisionVolume): THREE.BufferGeometry {
  const solid = collisionSolid(volume);
  const round = volume.type === "sphere" || volume.type === "ellipsoid";
  const lines = round
    ? new THREE.WireframeGeometry(solid)
    : new THREE.EdgesGeometry(solid);
  solid.dispose();
  return lines;
}

/** The volume as a solid one elmo across, for the lines to come off. Its size
 *  is on the object rather than in here, so the same shape serves any size. */
function collisionSolid(volume: LegoCollisionVolume): THREE.BufferGeometry {
  switch (volume.type) {
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "cylx":
    case "cyly":
    case "cylz": {
      // Three.js builds a cylinder along y, so the other two axes turn onto it.
      const solid = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      if (volume.type === "cylx") solid.rotateZ(Math.PI / 2);
      if (volume.type === "cylz") solid.rotateX(Math.PI / 2);
      return solid;
    }
    default:
      // A sphere and an ellipsoid are the same shape. Which one it turns out
      // to be is entirely in the scales the object carries.
      return new THREE.SphereGeometry(0.5, 16, 10);
  }
}
