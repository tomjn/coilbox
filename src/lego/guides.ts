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
 * A guide is a plane (one coordinate fixed) or a line along an axis through a
 * point (two coordinates fixed).
 *
 * Snap priority while a piece is moved, highest first:
 *   1. an anchor of another piece (a point, so it fixes all three coordinates)
 *   2. a guide line, then guide planes, for the coordinates a line leaves
 *      free (a line fixes two, so only a plane across the line can add the
 *      third)
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

const round = (n: number) => String(Number(n.toFixed(3)));

/** A name to start a guide with, which the game maker can change. */
export function guideName(
  guide: Pick<LegoGuide, "axis" | "kind" | "offset" | "point">,
): string {
  if (guide.kind !== "line")
    return `${guide.axis} = ${round(guide.offset ?? 0)}`;
  const [a, b] = crossAxes(guide.axis);
  const point = guide.point ?? [0, 0, 0];
  return `${guide.axis} line (${a} ${round(point[GUIDE_AXES.indexOf(a)])}, ${b} ${round(point[GUIDE_AXES.indexOf(b)])})`;
}

/** What the next click on the model places: a plane or a line along an axis. */
export interface GuidePick {
  kind: "plane" | "line";
  axis: GuideAxis;
}

/** The other two axes, which a line along `axis` is placed by. */
export function crossAxes(axis: GuideAxis): [GuideAxis, GuideAxis] {
  return GUIDE_AXES.filter((a) => a !== axis) as [GuideAxis, GuideAxis];
}

/** A line guide placed in the world: along `direction`, through `point`. */
export interface GuideLine {
  id: string;
  name: string;
  axis: GuideAxis;
  direction: Vec3;
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

/** The id of the built-in symmetry plane. A saved guide never has it, so it
 *  cannot be edited, removed or saved by anything that works on `project.guides`. */
export const SYMMETRY_GUIDE_ID = "symmetry";

/** The plane x = 0 in the root's frame, which symmetry mode mirrors across. */
export function symmetryPlane(project: LegoProject): GuidePlane {
  return placePlanes(project, [
    { id: SYMMETRY_GUIDE_ID, name: "Symmetry", axis: "x", offset: 0 },
  ])[0];
}

function placePlanes(project: LegoProject, guides: LegoGuide[]): GuidePlane[] {
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
        axis
          .clone()
          .multiplyScalar(guide.offset ?? 0)
          .applyMatrix4(frame),
      ),
    };
  });
}

/** Every guide that is shown, as a plane in the world. A hidden guide is not
 *  here, so it neither draws nor snaps. With `symmetry`, the built-in symmetry
 *  plane is added, which is drawn and snapped to like any other. */
export function guidePlanes(
  project: LegoProject,
  { symmetry = false }: { symmetry?: boolean } = {},
): GuidePlane[] {
  const planes = placePlanes(
    project,
    (project.guides ?? []).filter(
      (guide) => !guide.hidden && guide.kind !== "line",
    ),
  );
  return symmetry ? [...planes, symmetryPlane(project)] : planes;
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

/** Every line guide that is shown, as a line in the world. */
export function guideLines(project: LegoProject): GuideLine[] {
  const guides = (project.guides ?? []).filter(
    (guide) => !guide.hidden && guide.kind === "line" && guide.point,
  );
  if (guides.length === 0) return [];
  const frame = guideFrame(project);
  const turn = new THREE.Matrix3().setFromMatrix4(frame);
  return guides.map((guide) => ({
    id: guide.id,
    name: guide.name,
    axis: guide.axis,
    direction: tidy(
      new THREE.Vector3(...AXIS_VECTORS[guide.axis])
        .applyMatrix3(turn)
        .normalize(),
    ),
    point: tidy(
      new THREE.Vector3(...(guide.point as Vec3)).applyMatrix4(frame),
    ),
  }));
}

/** A point in the world as a line guide's point: in the unit's own space, with
 *  the coordinate along `axis` left at 0. */
export function guidePointAt(
  project: LegoProject,
  axis: GuideAxis,
  world: Vec3,
): Vec3 {
  const local = new THREE.Vector3(...world).applyMatrix4(
    guideFrame(project).invert(),
  );
  local.setComponent(GUIDE_AXES.indexOf(axis), 0);
  return tidy(local);
}

/**
 * How far the given points are to move so the nearest one to a guide lands on
 * it.
 *
 * The nearest line in reach settles the two coordinates across it. Each axis's
 * planes are then settled on their own: the planes of one axis are parallel,
 * so the nearest wins, and planes of different axes are at right angles, so
 * what one moves does not change the distance to another. With a line applied,
 * only the planes across the line's own axis still count, since the line has
 * already fixed the other two coordinates. A guide never pulls a point along
 * itself.
 */
export function snapToGuides(
  points: Vec3[],
  planes: GuidePlane[],
  threshold: number,
  lines: GuideLine[] = [],
): { delta: Vec3; guides: (GuidePlane | GuideLine)[] } {
  const delta = new THREE.Vector3();
  const guides: (GuidePlane | GuideLine)[] = [];

  let nearest: { line: GuideLine; across: THREE.Vector3 } | null = null;
  for (const line of lines) {
    const along = new THREE.Vector3(...line.direction);
    for (const point of points) {
      const across = new THREE.Vector3(...point)
        .sub(new THREE.Vector3(...line.point))
        .projectOnPlane(along);
      if (
        across.length() <= threshold &&
        (!nearest || across.length() < nearest.across.length())
      ) {
        nearest = { line, across };
      }
    }
  }
  if (nearest) {
    delta.sub(nearest.across);
    guides.push(nearest.line);
  }

  for (const axis of GUIDE_AXES) {
    if (nearest && axis !== nearest.line.axis) continue;
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
