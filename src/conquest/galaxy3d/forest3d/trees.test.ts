import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SPECIES } from "./placement";
import { treeGeometry, treeTriangles } from "./trees";

describe("treeGeometry", () => {
  for (const species of SPECIES)
    for (const far of [false, true])
      it(`stands a ${far ? "far" : "near"} ${species.id} on the ground, one tree high and one crown wide`, () => {
        const g = treeGeometry(species, far);
        g.computeBoundingBox();
        const box = g.boundingBox as THREE.Box3;
        // A rock is sunk into the ground. Everything else stands on it.
        if (species.look === "rock") {
          expect(box.min.y).toBeLessThan(0);
          expect(box.min.y).toBeGreaterThan(-0.3);
        } else expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
        expect(box.max.y).toBeGreaterThan(0.85);
        expect(box.max.y).toBeLessThan(1.2);
        // A cactus or a dead tree is a stem, thinner than a crown.
        const stem = species.look === "wood" || species.look === "cactus";
        expect(box.max.x - box.min.x).toBeGreaterThan(stem ? 0.25 : 0.6);
        expect(box.max.x - box.min.x).toBeLessThan(1.5);
        const count = g.getAttribute("position").count;
        for (const name of ["normal", "up", "foliage"])
          expect(g.getAttribute(name).count, name).toBe(count);
        const up = g.getAttribute("up");
        for (let i = 0; i < count; i++) {
          expect(up.getX(i)).toBeGreaterThanOrEqual(0);
          expect(up.getX(i)).toBeLessThanOrEqual(1);
        }
        g.dispose();
      });

  it("draws a far tree in fewer triangles than a near one", () => {
    for (const [id, [near, far]] of Object.entries(treeTriangles())) {
      expect(far, id).toBeLessThan(near / 2);
      expect(near, id).toBeLessThanOrEqual(140);
    }
  });
});
