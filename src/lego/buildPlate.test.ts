import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildGround,
  disposeGround,
  GROUND_ELMOS,
  PLATE_FOOTPRINTS,
  REFERENCE_PARK_X,
} from "./buildPlate";
import { REFERENCE_WIDTH_ELMOS } from "./referenceObject";
import { ELMOS_PER_FOOTPRINT } from "./unitDef";

function named(prefix: string): THREE.Object3D[] {
  return buildGround().children.filter((child) =>
    child.name.startsWith(prefix),
  );
}

describe("buildGround", () => {
  it("reaches wide enough to hold the reference unit", () => {
    const farEdge = REFERENCE_PARK_X - REFERENCE_WIDTH_ELMOS / 2;
    expect(farEdge).toBeGreaterThan(-GROUND_ELMOS / 2);
  });

  it("parks the reference unit clear of the largest plate", () => {
    const largest = Math.max(...PLATE_FOOTPRINTS) * ELMOS_PER_FOOTPRINT;
    const nearEdge = REFERENCE_PARK_X + REFERENCE_WIDTH_ELMOS / 2;
    expect(nearEdge).toBeLessThan(-largest / 2);
    // And no further out than half a step past it, so both fit in one view.
    expect(nearEdge).toBeGreaterThan(-largest / 2 - ELMOS_PER_FOOTPRINT);
  });

  it("marks a plate per common footprint, at footprint size", () => {
    const plates = named("plate-").filter(
      (child) => !child.name.startsWith("plate-label-"),
    );
    expect(plates.length).toBe(PLATE_FOOTPRINTS.length);
    plates.forEach((plate, at) => {
      const size = new THREE.Box3()
        .setFromObject(plate)
        .getSize(new THREE.Vector3());
      const expected = PLATE_FOOTPRINTS[at] * ELMOS_PER_FOOTPRINT;
      expect(size.x).toBeCloseTo(expected, 5);
      expect(size.z).toBeCloseTo(expected, 5);
    });
  });

  it("centres every plate on the origin, flat on the ground", () => {
    for (const plate of named("plate-")) {
      const box = new THREE.Box3().setFromObject(plate);
      expect(box.min.y).toBeGreaterThan(0);
      expect(box.max.y).toBeLessThan(0.1);
      if (plate.name.startsWith("plate-label-")) continue;
      expect(box.min.x + box.max.x).toBeCloseTo(0, 5);
      expect(box.min.z + box.max.z).toBeCloseTo(0, 5);
    }
  });

  it("writes each plate's number inside that plate", () => {
    for (const footprint of PLATE_FOOTPRINTS) {
      const [label] = named(`plate-label-${footprint}`);
      const box = new THREE.Box3().setFromObject(label);
      const half = (footprint * ELMOS_PER_FOOTPRINT) / 2;
      expect(box.min.x).toBeGreaterThan(-half);
      expect(box.max.x).toBeLessThan(half);
      expect(box.min.z).toBeGreaterThan(-half);
      expect(box.max.z).toBeLessThan(half);
    }
  });

  it("draws bands, not one-pixel lines, and draws them see-through", () => {
    for (const child of buildGround().children) {
      const material = (child as THREE.Mesh).material as THREE.Material;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeLessThan(1);
    }
    for (const plate of named("plate-")) {
      expect(plate).toBeInstanceOf(THREE.Mesh);
    }
  });

  it("has a grid line every footprint step", () => {
    const grids = buildGround().children.filter(
      (child) => child instanceof THREE.GridHelper,
    );
    expect(grids.length).toBe(2);
    // The step grid is the wider of the two, and one of its squares is one
    // plate square.
    const size = new THREE.Box3()
      .setFromObject(grids[1])
      .getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(GROUND_ELMOS, 5);
    expect(GROUND_ELMOS % ELMOS_PER_FOOTPRINT).toBe(0);
  });
});

describe("disposeGround", () => {
  it("does not throw on freshly built ground", () => {
    expect(() => disposeGround(buildGround())).not.toThrow();
  });
});
