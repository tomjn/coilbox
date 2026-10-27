/**
 * A layout's terrain steps as volumes on the editor's ground (issue #4793).
 *
 * The in-game widget's preview, drawn the same way: `stepMesh` in
 * `@/blueprint/terrainMesh.ts` ports its mesh and its colours. The editor's
 * ground is flat, so the volumes have a flat top and
 * straight sides. Issue #4794 replaces this layer with the ground as the steps
 * leave it, slopes included, and nothing else draws into it.
 */

import * as THREE from "three";

import type { TerrainStep } from "@/blueprint/model";
import type { GroundHeights } from "@/blueprint/terraform";
import { stepCorners } from "@/blueprint/terraform";
import {
  FACE_ALPHA,
  type StepMesh,
  stepMesh,
  type Vec3,
  VOLUME_COLORS,
} from "@/blueprint/terrainMesh";
import type { MapScene3D } from "@/lib/mapScene";
import type { Point } from "@/scenario/model";
import { worldToScene } from "./scene";

/** A step with more cells than this is not drawn as a volume, as the widget
 *  does (`M.CELL_LIMIT`), since the one being drawn is rebuilt as the pointer
 *  moves. */
const CELL_LIMIT = 4000;

/** Flat ground at 0, which is all the editor's ground is. Reads off its edge
 *  are clamped, so a tiny grid answers 0 everywhere. */
const FLAT: GroundHeights = {
  width: 2,
  height: 2,
  heights: new Float32Array(4),
};
const flat = () => 0;

const meshes = new WeakMap<TerrainStep, StepMesh | null>();

/** A step's mesh, worked out once per step value. */
function meshOf(step: TerrainStep): StepMesh | null {
  const known = meshes.get(step);
  if (known !== undefined) return known;
  const corners = stepCorners(step, FLAT, { x: 0, z: 0 });
  const mesh = corners ? stepMesh(corners, flat, CELL_LIMIT) : null;
  meshes.set(step, mesh);
  return mesh;
}

export interface TerrainVolumes {
  /** Draw these steps, replacing what was drawn. `draft` is a step still
   *  being drawn, shown the same way. */
  draw: (
    origin: Point,
    steps: readonly TerrainStep[],
    hidden: ReadonlySet<number> | undefined,
    draft: TerrainStep | null,
  ) => void;
  dispose: () => void;
}

export function createTerrainVolumes(deps: {
  handle: MapScene3D;
  worldWidth: number;
  worldHeight: number;
  groundAt: (pos: Point) => number;
}): TerrainVolumes {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = "blueprint-terrain-volumes";
  handle.scene.add(root);
  let owned: { dispose: () => void }[] = [];

  const color = (rgb: readonly number[]) =>
    new THREE.Color(rgb[0], rgb[1], rgb[2]);

  const material = {
    faces: new THREE.MeshBasicMaterial({
      color: color(VOLUME_COLORS.raise),
      transparent: true,
      opacity: FACE_ALPHA,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    wire: new THREE.LineBasicMaterial({
      color: color(VOLUME_COLORS.wireRaise),
      transparent: true,
      opacity: VOLUME_COLORS.wireRaise[3],
      depthWrite: false,
    }),
    downFaces: new THREE.MeshBasicMaterial({
      color: color(VOLUME_COLORS.dig),
      transparent: true,
      opacity: FACE_ALPHA,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
    downWire: new THREE.LineBasicMaterial({
      color: color(VOLUME_COLORS.wireDig),
      transparent: true,
      opacity: VOLUME_COLORS.wireDig[3],
      depthWrite: false,
      depthTest: false,
    }),
    grid: new THREE.LineBasicMaterial({
      color: color(VOLUME_COLORS.ground),
      transparent: true,
      opacity: VOLUME_COLORS.ground[3],
      depthWrite: false,
    }),
  };

  const geometryOf = (points: Vec3[]) => {
    const positions = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) positions.set(points[i], i * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    owned.push(geometry);
    return geometry;
  };

  const stepGroup = (step: TerrainStep): THREE.Group => {
    const group = new THREE.Group();
    const mesh = meshOf(step);
    if (mesh) {
      if (mesh.faces.length) {
        group.add(new THREE.Mesh(geometryOf(mesh.faces), material.faces));
      }
      if (mesh.downFaces.length) {
        const pit = new THREE.Mesh(
          geometryOf(mesh.downFaces),
          material.downFaces,
        );
        pit.renderOrder = 2;
        group.add(pit);
      }
      for (const name of ["wire", "downWire", "grid"] as const) {
        if (!mesh[name].length) continue;
        const lines = new THREE.LineSegments(
          geometryOf(mesh[name]),
          material[name],
        );
        lines.renderOrder = 2;
        group.add(lines);
      }
    }
    return group;
  };

  return {
    draw: (origin, steps, hidden, draft) => {
      root.clear();
      for (const spent of owned) spent.dispose();
      owned = [];
      const at = worldToScene(
        origin,
        deps.worldWidth,
        deps.worldHeight,
        handle.scale,
      );
      root.position.set(at.x, deps.groundAt(origin) * handle.scale, at.z);
      root.scale.setScalar(handle.scale);
      steps.forEach((step, index) => {
        if (hidden?.has(index)) return;
        root.add(stepGroup(step));
      });
      if (draft) root.add(stepGroup(draft));
      handle.render();
    },
    dispose: () => {
      root.clear();
      for (const spent of owned) spent.dispose();
      owned = [];
      for (const one of Object.values(material)) one.dispose();
      root.removeFromParent();
      handle.render();
    },
  };
}
