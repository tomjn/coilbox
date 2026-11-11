import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTerrainSurface, type HeightGrid } from "../terrain";
import { pickSite } from "./site";

const SIDE = 101;
/** A 100 by 100 map, 200 world units across, its heights from a function of map x and y. */
const surfaceOf = (h: (x: number, y: number) => number) => {
  const data = new Float32Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) data[y * SIDE + x] = h(x, y);
  const grid: HeightGrid = { data, width: SIDE, height: SIDE };
  return createTerrainSurface(
    { width: 100, height: 100, heightScale: 10 },
    200,
    grid,
  );
};
const flat = surfaceOf(() => 0.5);
const REACH = 3.6;
const FAR: [number, number] = [80, 80];

describe("pickSite", () => {
  it("stands on the node itself on flat ground, full size", () => {
    const site = pickSite(flat, [0, 0], [FAR], undefined, REACH, 0.38);
    expect(site).not.toBeNull();
    expect(site?.x).toBeCloseTo(0);
    expect(site?.z).toBeCloseTo(0);
    expect(site?.scale).toBe(1);
    expect(site?.ground(0, 0)).toBeCloseTo(0);
  });

  it("moves off a slope onto the flatter side", () => {
    // Flat west of the middle, rising steeply to the east.
    const slope = surfaceOf((x) => 0.4 + Math.max(0, x - 50) * 0.02);
    const site = pickSite(slope, [0, 0], [FAR], undefined, REACH, 0.38);
    expect(site?.x).toBeLessThan(0);
  });

  it("shrinks to its share of the way to the nearest neighbour", () => {
    const d = 10;
    const a = pickSite(flat, [0, 0], [[d, 0]], undefined, REACH, 0.38);
    const b = pickSite(flat, [d, 0], [[0, 0]], undefined, REACH, 0.38);
    expect(a && a.scale * REACH).toBeLessThanOrEqual(0.38 * d + 1e-9);
    if (!a || !b) throw new Error("both stand");
    const gap = Math.hypot(b.x - a.x, b.z - a.z);
    expect(gap).toBeGreaterThan(a.scale * REACH + b.scale * REACH);
  });

  it("reads the ground where a turned, shrunk group puts each point", () => {
    const slope = surfaceOf((x, y) => 0.3 + x * 0.004 + y * 0.002);
    const site = pickSite(slope, [0, 0], [[8, 0]], [0, 10], REACH, 0.38);
    if (!site) throw new Error("stands");
    const group = new THREE.Object3D();
    group.position.set(site.x, site.y, site.z);
    group.rotation.y = site.facing;
    group.scale.setScalar(site.scale);
    group.updateMatrixWorld();
    const p = new THREE.Vector3(1.5, 0, -0.7).applyMatrix4(group.matrixWorld);
    expect(site.ground(1.5, -0.7) * site.scale + site.y).toBeCloseTo(
      slope.groundHeightAtWorld(p.x, p.z),
      5,
    );
  });

  it("gives up where every site is under the sea", () => {
    const sea = surfaceOf(() => 0);
    expect(pickSite(sea, [0, 0], [FAR], undefined, REACH, 0.38)).toBeNull();
  });

  it("turns its long wall, which runs along its -x, away from the road", () => {
    const along = (toward: [number, number]) => {
      const f =
        pickSite(flat, [0, 0], [FAR], toward, REACH, 0.38)?.facing ?? NaN;
      // Where a group turned by `facing` sends its +x.
      return [Math.cos(f), -Math.sin(f)];
    };
    const east = along([10, 0]);
    expect(east[0]).toBeCloseTo(1);
    expect(east[1]).toBeCloseTo(0);
    const south = along([0, 10]);
    expect(south[0]).toBeCloseTo(0);
    expect(south[1]).toBeCloseTo(1);
  });
});
