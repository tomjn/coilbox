import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { STRONGHOLD_PALETTES } from "./palettes";
import { insideShield } from "./shield";
import { buildStronghold, STRONGHOLD_REACH } from "./stronghold";

const flat = () => 0;
/** Just inside the crag's sheet, which reaches 3.6. */
const CRAG_EDGE = 3.6 - 1e-3;
const p = STRONGHOLD_PALETTES.temperate;

describe("buildStronghold", () => {
  const { built, shield } = buildStronghold(flat, p, 7);

  it("has a crag, a tower and masts", () => {
    for (const tag of ["crag", "tower", "mast"] as const)
      expect(built.bounds(tag), tag).not.toBeNull();
    console.info(`stronghold triangles: ${built.triangles}`);
  });

  it("covers every part of the tower and its masts with the shield", () => {
    for (const tag of ["tower", "mast"] as const) {
      const v = built.vertices(tag);
      const point = new THREE.Vector3();
      for (let i = 0; i < v.length; i += 3) {
        point.set(v[i], v[i + 1], v[i + 2]);
        expect(insideShield(shield.radii, shield.centre, point)).toBe(true);
      }
    }
  });

  it("stays inside its reach", () => {
    let far = 0;
    for (const g of [built.solid, built.soft]) {
      if (!g) continue;
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++)
        far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    console.info(`stronghold footprint: ${far}`);
    expect(far).toBeLessThanOrEqual(STRONGHOLD_REACH);
  });

  /** The colours of the crag's outermost ring, the vertices furthest out. */
  const outerRing = (g: THREE.BufferGeometry) => {
    const pos = g.getAttribute("position");
    const col = g.getAttribute("color");
    const out: [number, number, number][] = [];
    for (let i = 0; i < pos.count; i++)
      if (Math.hypot(pos.getX(i), pos.getZ(i)) > CRAG_EDGE)
        out.push([col.getX(i), col.getY(i), col.getZ(i)]);
    return out;
  };

  it("takes the ground's colour at the crag's edge", () => {
    const red = buildStronghold(flat, p, 7, () => [255, 0, 0]).built;
    const ring = outerRing(red.soft as THREE.BufferGeometry);
    expect(ring.length).toBeGreaterThan(0);
    for (const [r, g, b] of ring) {
      expect(r).toBeCloseTo(1, 1);
      expect(g).toBeLessThan(0.02);
      expect(b).toBeLessThan(0.02);
    }
  });

  it("keeps the rock's colour where the ground's is unknown", () => {
    const plain = buildStronghold(flat, p, 7, () => undefined).built;
    for (const [r, g] of outerRing(plain.soft as THREE.BufferGeometry))
      expect(Math.abs(r - g)).toBeLessThan(0.05);
  });
});
