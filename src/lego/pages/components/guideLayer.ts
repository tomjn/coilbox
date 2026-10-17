/**
 * The guide planes and lines, drawn in the viewport (issue #3318).
 *
 * Each plane is a thin translucent square with an outline, centred on the unit
 * and sized to reach past it. Each line is a single stroke through its point,
 * as long as a square is wide. Drawn over the model so a plane through a part
 * never hides behind it, and never picked: a click goes through to the piece.
 * A view aid like the grid, never exported.
 */

import * as THREE from "three";
import type { GuideLine, GuidePlane } from "../../guides";
import type { Vec3 } from "../../snapping";

/** Indigo. No other helper draws in it: anchors are sky blue, amber, pink and
 *  emerald, the collision volume orange and yellow, the aim point red. */
export const GUIDE_COLOUR = 0x818cf8;

const FILL_OPACITY = 0.1;
const LINE_OPACITY = 0.7;
/** The square reaches this far past the unit's biggest side. */
const REACH = 1.5;

/**
 * One group holding a square per plane and a stroke per line.
 *
 * `around` is the box of what they should surround, in the world. They are
 * centred on its middle, moved onto their plane or line.
 */
export function buildGuides(
  planes: GuidePlane[],
  around: THREE.Box3,
  minimumSize: number,
  lines: GuideLine[] = [],
): THREE.Group {
  const group = new THREE.Group();
  group.name = "guides";
  const middle = around.isEmpty()
    ? new THREE.Vector3()
    : around.getCenter(new THREE.Vector3());
  const size = Math.max(
    minimumSize,
    around.isEmpty() ? 0 : around.getSize(new THREE.Vector3()).length() * REACH,
  );

  for (const plane of planes) {
    const normal = new THREE.Vector3(...plane.normal);
    const point = new THREE.Vector3(...plane.point);
    // The middle of the unit, dropped onto the plane.
    const centre = middle
      .clone()
      .addScaledVector(normal, point.clone().sub(middle).dot(normal));

    const square = new THREE.PlaneGeometry(size, size);
    const fill = new THREE.Mesh(
      square,
      new THREE.MeshBasicMaterial({
        color: GUIDE_COLOUR,
        transparent: true,
        opacity: FILL_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(square),
      new THREE.LineBasicMaterial({
        color: GUIDE_COLOUR,
        transparent: true,
        opacity: LINE_OPACITY,
        depthTest: false,
      }),
    );
    for (const part of [fill, outline]) {
      part.renderOrder = 3;
      part.raycast = () => {};
      part.userData.guideId = plane.id;
    }

    const plate = new THREE.Group();
    plate.name = `guide-${plane.id}`;
    plate.add(fill, outline);
    plate.position.copy(centre);
    plate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    group.add(plate);
  }

  for (const line of lines) {
    const direction = new THREE.Vector3(...line.direction);
    const point = new THREE.Vector3(...line.point);
    // The middle of the unit, dropped onto the line.
    const centre = point
      .clone()
      .addScaledVector(direction, middle.clone().sub(point).dot(direction));

    const stroke = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, -size / 2),
        new THREE.Vector3(0, 0, size / 2),
      ]),
      new THREE.LineBasicMaterial({
        color: GUIDE_COLOUR,
        transparent: true,
        opacity: LINE_OPACITY,
        depthTest: false,
      }),
    );
    stroke.renderOrder = 3;
    stroke.raycast = () => {};
    stroke.userData.guideId = line.id;
    stroke.name = `guide-${line.id}`;
    stroke.position.copy(centre);
    stroke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    group.add(stroke);
  }
  return group;
}

/** Frees every geometry and material `buildGuides` made. */
export function disposeGuides(group: THREE.Group): void {
  group.removeFromParent();
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
}

/** The point a guide is drawn through, for tests and labels. */
export function guideCentre(group: THREE.Group, id: string): Vec3 | null {
  const plate = group.getObjectByName(`guide-${id}`);
  return plate ? [plate.position.x, plate.position.y, plate.position.z] : null;
}
