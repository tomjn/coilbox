/**
 * The range a selected piece may turn through, drawn as a fan at the piece
 * (issue #3353).
 *
 * A yaw range is a fan on the level at the piece's height, pointing the way
 * the piece faces at rest and spanning the range. A pitch range is a fan in
 * the plane running forward and up, with its edge at level along the front.
 * Drawn over everything, like the weapon rings, and never exported.
 */

import * as THREE from "three";
import { pitchRange, yawRange } from "../../jointLimits";
import type { LegoPieceLimits } from "../../model";
import type { Vec3 } from "../../snapping";

/** How far the fan reaches from the piece, in elmos. A choice of drawing size. */
const RADIUS = 16;
const SEGMENTS = 48;
const YAW_COLOUR = 0xfacc15;
const PITCH_COLOUR = 0x38bdf8;

const RADIANS = Math.PI / 180;

/** A direction to the right of the front by `degrees`: the model's right is -x. */
function level(degrees: number): Vec3 {
  return [
    -Math.sin(degrees * RADIANS) * RADIUS,
    0,
    Math.cos(degrees * RADIANS) * RADIUS,
  ];
}

/** A direction `degrees` above the level, straight ahead. */
function raised(degrees: number): Vec3 {
  return [
    0,
    Math.sin(degrees * RADIANS) * RADIUS,
    Math.cos(degrees * RADIANS) * RADIUS,
  ];
}

function fan(
  centre: Vec3,
  from: number,
  to: number,
  direction: (degrees: number) => Vec3,
  colour: number,
): THREE.Group {
  const group = new THREE.Group();
  const rim: Vec3[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const [x, y, z] = direction(from + ((to - from) * i) / SEGMENTS);
    rim.push([centre[0] + x, centre[1] + y, centre[2] + z]);
  }
  const outline = new THREE.Line(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute([centre, ...rim, centre].flat(), 3),
    ),
    new THREE.LineBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    }),
  );
  outline.renderOrder = 4;
  outline.raycast = () => {};
  group.add(outline);

  const index: number[] = [];
  for (let i = 1; i <= SEGMENTS; i++) index.push(0, i, i + 1);
  const fill = new THREE.Mesh(
    new THREE.BufferGeometry()
      .setAttribute(
        "position",
        new THREE.Float32BufferAttribute([centre, ...rim].flat(), 3),
      )
      .setIndex(index),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.15,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  fill.renderOrder = 3;
  fill.raycast = () => {};
  group.add(fill);
  return group;
}

/** The fans for a piece's limits at `at`, or null when it has none. */
export function buildJointLimits(
  limits: LegoPieceLimits | undefined,
  at: Vec3,
): THREE.Group | null {
  const yaw = yawRange(limits);
  const pitch = pitchRange(limits);
  if (!yaw && !pitch) return null;
  const group = new THREE.Group();
  if (yaw) group.add(fan(at, yaw.min, yaw.max, level, YAW_COLOUR));
  if (pitch) group.add(fan(at, pitch.min, pitch.max, raised, PITCH_COLOUR));
  return group;
}

/** Free what `buildJointLimits` made. */
export function disposeJointLimits(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Line || object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  group.removeFromParent();
}
