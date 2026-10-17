/**
 * The overlap check drawn on the unit (issue #3343): an orange outline round
 * the box of each buried piece. The piece itself is hidden inside its holder, so
 * the outline is drawn over everything, like the balance and footprint checks.
 * Never exported.
 */

import * as THREE from "three";
import type { OverlapResult } from "../../overlap";

const COLOUR = 0xf97316;

/** The 12 edges of a box, as pairs of corners. */
function edges(min: number[], max: number[]): number[] {
  const corner = (i: number) => [
    i & 1 ? max[0] : min[0],
    i & 2 ? max[1] : min[1],
    i & 4 ? max[2] : min[2],
  ];
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      out.push(...corner(i), ...corner(i | bit));
    }
  }
  return out;
}

/** The drawing for a result, or null when nothing is buried. */
export function buildOverlap(result: OverlapResult): THREE.Group | null {
  if (result.buried.length === 0) return null;
  const group = new THREE.Group();
  for (const { box } of result.buried) {
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(edges(box.min, box.max), 3),
      ),
      new THREE.LineBasicMaterial({
        color: COLOUR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    lines.renderOrder = 3;
    lines.raycast = () => {};
    group.add(lines);
  }
  return group;
}

/** Free what `buildOverlap` made. */
export function disposeOverlap(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  group.removeFromParent();
}
