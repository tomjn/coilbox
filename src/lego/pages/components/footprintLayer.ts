/**
 * The footprint check drawn on the ground (issue #3340): a rectangle of
 * footprint steps under the unit, in the style of the build plates.
 *
 * Green for the footprint the export writes, orange once the unit sticks out of
 * the footprint in force. A smaller blue rectangle is the base alone, and a
 * grey one is the footprint already written when it is not the one the export
 * would write now. Drawn over everything, like the balance check, so the unit's
 * own hull never hides it. Never exported.
 */

import * as THREE from "three";
import type { FootprintResult } from "../../footprint";
import { ELMOS_PER_FOOTPRINT } from "../../unitDef";

/** Above the plates' own height, so the two do not fight for the same pixels. */
const LIFT = 0.06;
/** The width of a rectangle's band, in elmos: the plates' own. */
const BAND = 0.35;

const COLOURS = {
  fits: 0x4ade80,
  overhangs: 0xf97316,
  base: 0x60a5fa,
  written: 0x94a3b8,
} as const;

export function footprintColour(
  result: Extract<FootprintResult, { status: "ok" }>,
): string {
  const hex =
    result.overhang.x > 0 || result.overhang.z > 0
      ? COLOURS.overhangs
      : COLOURS.fits;
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/** A rectangular band centred on the origin and lying on the ground. */
function band(xElmos: number, zElmos: number, colour: number): THREE.Mesh {
  const outerX = xElmos / 2;
  const outerZ = zElmos / 2;
  const innerX = Math.max(0, outerX - BAND);
  const innerZ = Math.max(0, outerZ - BAND);
  const ring: [number, number][] = [
    [-outerX, -outerZ],
    [outerX, -outerZ],
    [outerX, outerZ],
    [-outerX, outerZ],
    [-innerX, -innerZ],
    [innerX, -innerZ],
    [innerX, innerZ],
    [-innerX, innerZ],
  ];
  const index: number[] = [];
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    index.push(i, next, 4 + i, next, 4 + next, 4 + i);
  }
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry()
      .setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          ring.flatMap(([x, z]) => [x, LIFT, z]),
          3,
        ),
      )
      .setIndex(index),
    new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.renderOrder = 3;
  mesh.raycast = () => {};
  return mesh;
}

/** The drawing for a result, or null when the check does not apply. */
export function buildFootprint(result: FootprintResult): THREE.Group | null {
  if (result.status !== "ok") return null;
  const group = new THREE.Group();
  const rectangle = (
    steps: { x: number; z: number },
    colour: number,
  ): THREE.Mesh =>
    band(steps.x * ELMOS_PER_FOOTPRINT, steps.z * ELMOS_PER_FOOTPRINT, colour);

  const overhangs = result.overhang.x > 0 || result.overhang.z > 0;
  group.add(
    rectangle(result.now, overhangs ? COLOURS.overhangs : COLOURS.fits),
  );
  if (result.base.x !== result.now.x || result.base.z !== result.now.z) {
    group.add(rectangle(result.base, COLOURS.base));
  }
  if (result.differs && result.written) {
    group.add(rectangle(result.written, COLOURS.written));
  }
  return group;
}

/** Free what `buildFootprint` made. */
export function disposeFootprint(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  group.removeFromParent();
}
