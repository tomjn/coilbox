/**
 * Guide planes (issue #3318).
 *
 * A guide is a plane at a fixed offset along one axis of the unit's own space,
 * which is the root piece's frame, so moving or turning the root carries the
 * guides with it. Only the root's place and turn count: its scale would make
 * "x = 12" mean something different from the number typed.
 *
 * Guides are a view aid saved with the unit. Nothing here touches a piece, and
 * no exporter reads `project.guides`, so none of them can reach a file.
 *
 * Snap priority while a piece is moved, highest first:
 *   1. an anchor of another piece (a point, so it fixes all three coordinates)
 *   2. a guide plane (fixes the one coordinate across its normal)
 *   3. the move step in part units (rounds whatever is left)
 * Alt turns all three off.
 */

import * as THREE from "three";

import {
  GUIDE_AXES,
  type GuideAxis,
  type LegoGuide,
  type LegoProject,
} from "./model";
import { worldMatrix } from "./reparent";
import type { Vec3 } from "./snapping";

/** A guide placed in the world: where its plane is and which way it faces. */
export interface GuidePlane {
  id: string;
  name: string;
  axis: GuideAxis;
  normal: Vec3;
  /** Any point on the plane. */
  point: Vec3;
}

const AXIS_VECTORS: Record<GuideAxis, Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/** The root's place and turn, without its scale. */
export function guideFrame(project: LegoProject): THREE.Matrix4 {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  worldMatrix(project, project.rootPieceId).decompose(
    position,
    rotation,
    new THREE.Vector3(),
  );
  return new THREE.Matrix4().compose(
    position,
    rotation,
    new THREE.Vector3(1, 1, 1),
  );
}

/** `+ 0` turns a negative zero into a plain one. */
function tidy(v: THREE.Vector3): Vec3 {
  return [v.x + 0, v.y + 0, v.z + 0];
}

/** Every guide that is shown, as a plane in the world. A hidden guide is not
 *  here, so it neither draws nor snaps. */
export function guidePlanes(project: LegoProject): GuidePlane[] {
  const guides = (project.guides ?? []).filter((guide) => !guide.hidden);
  if (guides.length === 0) return [];
  const frame = guideFrame(project);
  const turn = new THREE.Matrix3().setFromMatrix4(frame);
  return guides.map((guide) => {
    const axis = new THREE.Vector3(...AXIS_VECTORS[guide.axis]);
    return {
      id: guide.id,
      name: guide.name,
      axis: guide.axis,
      normal: tidy(axis.clone().applyMatrix3(turn).normalize()),
      point: tidy(
        axis.clone().multiplyScalar(guide.offset).applyMatrix4(frame),
      ),
    };
  });
}

/** Where a point in the world sits along `axis` of the unit's own space. */
export function guideOffsetAt(
  project: LegoProject,
  axis: GuideAxis,
  world: Vec3,
): number {
  const local = new THREE.Vector3(...world).applyMatrix4(
    guideFrame(project).invert(),
  );
  return local.getComponent(GUIDE_AXES.indexOf(axis));
}

/**
 * How far the given points are to move so the nearest one to each axis's
 * nearest guide lands on it.
 *
 * Each axis is settled on its own: the guides of one axis are parallel, so the
 * nearest one wins, and guides of different axes are at right angles, so what
 * one moves does not change the distance to another. A guide never pulls a
 * point along its plane, so two guides on different axes fix two coordinates
 * and leave the third alone.
 */
export function snapToGuides(
  points: Vec3[],
  planes: GuidePlane[],
  threshold: number,
): { delta: Vec3; guides: GuidePlane[] } {
  const delta = new THREE.Vector3();
  const guides: GuidePlane[] = [];

  for (const axis of GUIDE_AXES) {
    let best: { plane: GuidePlane; distance: number } | null = null;
    for (const plane of planes) {
      if (plane.axis !== axis) continue;
      for (const point of points) {
        const distance =
          (point[0] - plane.point[0]) * plane.normal[0] +
          (point[1] - plane.point[1]) * plane.normal[1] +
          (point[2] - plane.point[2]) * plane.normal[2];
        if (
          Math.abs(distance) <= threshold &&
          (!best || Math.abs(distance) < Math.abs(best.distance))
        ) {
          best = { plane, distance };
        }
      }
    }
    if (!best) continue;
    delta.addScaledVector(
      new THREE.Vector3(...best.plane.normal),
      -best.distance,
    );
    guides.push(best.plane);
  }

  return { delta: tidy(delta), guides };
}

/** The unit with the guides given, or without the key when none are left. */
function withGuides(project: LegoProject, guides: LegoGuide[]): LegoProject {
  const { guides: _old, ...rest } = project;
  return guides.length > 0 ? { ...rest, guides } : rest;
}

export function addGuide(project: LegoProject, guide: LegoGuide): LegoProject {
  return withGuides(project, [...(project.guides ?? []), guide]);
}

export function updateGuide(
  project: LegoProject,
  id: string,
  change: Partial<Omit<LegoGuide, "id">>,
): LegoProject {
  if (!project.guides?.some((guide) => guide.id === id)) return project;
  return withGuides(
    project,
    project.guides.map((guide) => {
      if (guide.id !== id) return guide;
      const { hidden, ...rest } = { ...guide, ...change };
      return hidden ? { ...rest, hidden: true } : rest;
    }),
  );
}

export function removeGuide(project: LegoProject, id: string): LegoProject {
  if (!project.guides?.some((guide) => guide.id === id)) return project;
  return withGuides(
    project,
    project.guides.filter((guide) => guide.id !== id),
  );
}
