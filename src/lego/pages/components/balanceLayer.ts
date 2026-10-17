/**
 * The balance check drawn on the ground (issue #3333): a dot under the unit's
 * centre of mass and an outline of the ground its feet or wheels cover.
 *
 * Green while the dot is inside the outline, orange once it is outside, grey
 * when the outline has no width. Drawn over everything, like the weapon rings,
 * so the unit's own hull never hides it. Never exported.
 */

import * as THREE from "three";
import type { BalanceResult } from "../../balance";

/** Lifted off y = 0 a little, so the fill does not fight the grid. */
const LIFT = 0.05;

const COLOURS = {
  inside: 0x4ade80,
  outside: 0xf97316,
  noWidth: 0x94a3b8,
} as const;

export function balanceColour(
  result: Exclude<BalanceResult, { status: "notApplicable" }>,
): string {
  return `#${COLOURS[result.status].toString(16).padStart(6, "0")}`;
}

/** The drawing for a result, or null when the check does not apply. */
export function buildBalance(result: BalanceResult): THREE.Group | null {
  if (result.status === "notApplicable") return null;
  const colour = COLOURS[result.status];
  const group = new THREE.Group();
  const on = (x: number, z: number): [number, number, number] => [x, LIFT, z];

  const outline = new THREE.LineBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const ring = result.support.map(([x, z]) => on(x, z));
  if (ring.length >= 2) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          (ring.length >= 3 ? [...ring, ring[0]] : ring).flat(),
          3,
        ),
      ),
      outline,
    );
    line.renderOrder = 4;
    line.raycast = () => {};
    group.add(line);
  }
  if (ring.length >= 3) {
    const index: number[] = [];
    for (let i = 1; i < ring.length - 1; i++) index.push(0, i, i + 1);
    const fill = new THREE.Mesh(
      new THREE.BufferGeometry()
        .setAttribute(
          "position",
          new THREE.Float32BufferAttribute(ring.flat(), 3),
        )
        .setIndex(index),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.12,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    fill.renderOrder = 3;
    fill.raycast = () => {};
    group.add(fill);
  }
  // A single foot or wheel has no outline, only the point it stands on.
  if (ring.length === 1) {
    const point = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(ring[0], 3),
      ),
      new THREE.PointsMaterial({
        color: colour,
        size: 6,
        sizeAttenuation: false,
        depthTest: false,
      }),
    );
    point.renderOrder = 4;
    point.raycast = () => {};
    group.add(point);
  }

  const dot = new THREE.Points(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(on(...result.centre), 3),
    ),
    new THREE.PointsMaterial({
      color: colour,
      size: 12,
      sizeAttenuation: false,
      depthTest: false,
    }),
  );
  dot.renderOrder = 5;
  dot.raycast = () => {};
  group.add(dot);
  return group;
}

/** Free what `buildBalance` made. */
export function disposeBalance(group: THREE.Group): void {
  group.traverse((object) => {
    if (
      object instanceof THREE.Line ||
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points
    ) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  group.removeFromParent();
}
