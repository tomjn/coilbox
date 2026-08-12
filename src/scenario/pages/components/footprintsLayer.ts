/**
 * The ground a base's buildings stand on, drawn on the editor's map.
 *
 * A building is not a model floating at a point: it occupies whole build squares
 * and the engine will not let a second one have any of them. Drawing that patch
 * is the difference between a layout an author thinks fits and one that does
 * (issue #1311). The square is the real footprint, turned with the building, and
 * it is drawn where the engine will stand it rather than where the document put
 * it, so a layout written by hand shows what will actually happen to it.
 *
 * Two buildings wanting the same ground are drawn in red. Both of them, because
 * neither is the one at fault, and it is the pair that has to be pulled apart.
 *
 * Nothing here carries a `placementKey` and the layer is not handed to
 * `useMapEditing`, so a footprint cannot be clicked. It lies under the building
 * it belongs to and would otherwise swallow every click meant for that building.
 *
 * The arithmetic is `@/blueprint/footprint`, which is tested. This file is the
 * drawing.
 */

import * as THREE from "three";

import type { FootprintMark } from "@/blueprint/footprint";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { worldToScene } from "@/placement/scene";
import type { Point } from "../../model";

/** What the footprints are drawn under, so they can be found and removed as one
 *  thing. */
const ROOT_NAME = "scenario-footprints";

/** How far above the ground a footprint sits, in elmos. The same clearance the
 *  zones take, for the same reason: the relief is drawn by a shader the layer
 *  only samples. */
const LIFT_ELMOS = 4;

/** What ground nobody is fighting over is drawn in, and what a pair fighting
 *  over it turns. Deliberately quiet until something is wrong. */
const GROUND_COLOR = 0x94a3b8;
const CLASH_COLOR = 0xf87171;

export interface FootprintsLayerDeps {
  handle: MapScene3D;
  /** Map extent in elmos, as `useMissionMapAssets` reports it. */
  worldWidth: number;
  worldHeight: number;
  /** The map's ground height in elmos at an engine position. */
  groundAt: (pos: Point) => number;
}

export interface FootprintsLayer {
  root: THREE.Group;
  /** Draw this list, replacing whatever was drawn before. */
  draw: (marks: FootprintMark[]) => void;
  dispose: () => void;
}

/** The four corners of a footprint, in elmos around its middle. */
function corners(width: number, depth: number): THREE.Vector3[] {
  const x = width / 2;
  const z = depth / 2;
  return [
    new THREE.Vector3(-x, 0, -z),
    new THREE.Vector3(x, 0, -z),
    new THREE.Vector3(x, 0, z),
    new THREE.Vector3(-x, 0, z),
  ];
}

export function createFootprintsLayer(
  deps: FootprintsLayerDeps,
): FootprintsLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = ROOT_NAME;
  handle.scene.add(root);

  /** Everything one pass allocated, so the next pass can free it. Each footprint
   *  is its own size, so there is nothing to share between two of them. */
  let owned: { dispose: () => void }[] = [];

  const buildMark = (mark: FootprintMark): THREE.Group => {
    const colour = mark.overlapping ? CLASH_COLOR : GROUND_COLOR;
    const width = mark.rect.maxX - mark.rect.minX;
    const depth = mark.rect.maxZ - mark.rect.minZ;
    const group = new THREE.Group();
    const at = worldToScene(
      mark.pos,
      deps.worldWidth,
      deps.worldHeight,
      handle.scale,
    );
    group.position.set(
      at.x,
      (deps.groundAt(mark.pos) + LIFT_ELMOS) * handle.scale,
      at.z,
    );
    // Everything below is in elmos, so the whole footprint takes the elmo scale.
    group.scale.setScalar(handle.scale);

    // The patch itself is depth tested, so a hill in front of it hides it the
    // way it hides the building standing on it.
    const fillGeometry = new THREE.PlaneGeometry(width, depth);
    fillGeometry.rotateX(-Math.PI / 2);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: mark.overlapping ? 0.32 : 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(fillGeometry, fillMaterial));

    // The outline is not, so the shape of a building's ground can be read from
    // above with the model itself standing in the middle of it.
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(
      corners(width, depth),
    );
    const lineMaterial = new THREE.LineBasicMaterial({
      color: colour,
      transparent: true,
      opacity: mark.overlapping ? 0.95 : 0.55,
      depthTest: false,
    });
    const outline = new THREE.LineLoop(lineGeometry, lineMaterial);
    outline.renderOrder = 2;
    group.add(outline);

    owned.push(fillGeometry, fillMaterial, lineGeometry, lineMaterial);
    return group;
  };

  const clear = () => {
    root.clear();
    for (const spent of owned) spent.dispose();
    owned = [];
  };

  return {
    root,
    draw: (marks) => {
      clear();
      for (const mark of marks) root.add(buildMark(mark));
      handle.render();
    },
    dispose: () => {
      clear();
      root.removeFromParent();
    },
  };
}
