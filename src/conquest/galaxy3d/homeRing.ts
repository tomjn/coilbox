/**
 * The ring round the player's capital on a terrain map, lying on the ground
 * just outside the town so no building stands through it.
 */
import * as THREE from "three";
import type { TerrainSurface } from "./terrain";

/** The gap between a town's own ring and the home ring's inner edge. */
export const HOME_RING_GAP = 0.25;
/** The ring's width, the same as the flat ring of a galaxy map. */
export const HOME_RING_WIDTH = 0.18;
/** How far above the terrain it lies, clear of a town's ground decal. */
const LIFT = 0.02;
/** The longest step between two points along the ring, so it follows the ground. */
const STEP = 0.15;
/** Drawn after a town's ground decal (-2.4) and before the borders (-2). */
const ORDER = -2.3;

/**
 * A ring draped on the terrain round `x, z`. `inner` is the distance to the
 * middle of each side of its inner edge, so a shape with few sides still
 * clears a town of that radius. `sides` of 0 is a circle. A shape has a corner
 * to the north, as a faction's badge does.
 */
export function homeRingGeometry(
  surface: Pick<TerrainSurface, "groundHeightAtWorld">,
  x: number,
  z: number,
  inner: number,
  sides: number,
): THREE.BufferGeometry {
  const n = sides > 2 ? sides : 48;
  const corner = 1 / Math.cos(Math.PI / n);
  const pos: number[] = [];
  const idx: number[] = [];
  const point = (ux: number, uz: number, r: number) => {
    const px = x + ux * r;
    const pz = z + uz * r;
    pos.push(px, surface.groundHeightAtWorld(px, pz) + LIFT, pz);
  };
  for (let k = 0; k < n; k++) {
    // North is -z, and the corners go round from there.
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    const from = [Math.sin(a0) * corner, -Math.cos(a0) * corner];
    const to = [Math.sin(a1) * corner, -Math.cos(a1) * corner];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) * inner;
    const steps = Math.max(1, Math.ceil(length / STEP));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const ux = from[0] + (to[0] - from[0]) * t;
      const uz = from[1] + (to[1] - from[1]) * t;
      point(ux, uz, inner);
      point(ux, uz, inner + HOME_RING_WIDTH);
    }
  }
  const count = pos.length / 6;
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  return geometry;
}

/** The home ring as a mesh in the faction's colour. The caller disposes of its geometry and material. */
export function buildHomeRing(
  surface: Pick<TerrainSurface, "groundHeightAtWorld">,
  x: number,
  z: number,
  /** The radius of the town's own ring. */
  townRing: number,
  sides: number,
  color: THREE.Color,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    homeRingGeometry(surface, x, z, townRing + HOME_RING_GAP, sides),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.renderOrder = ORDER;
  mesh.raycast = () => {};
  return mesh;
}
