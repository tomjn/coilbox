import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildFrontMarker,
  buildGround,
  disposeFrontMarker,
  disposeGround,
  GROUND_ELMOS,
  groundSteps,
  PLATE_FOOTPRINTS,
  REFERENCE_PARK_X,
  referenceParkX,
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

  it("parks a figure of any width the same distance clear", () => {
    // A unit read out of an installed game can be any size, so the near edge
    // is what stays put rather than the figure's own origin.
    const largest = Math.max(...PLATE_FOOTPRINTS) * ELMOS_PER_FOOTPRINT;
    for (const width of [4, REFERENCE_WIDTH_ELMOS, 120]) {
      const nearEdge = referenceParkX(width) + width / 2;
      expect(nearEdge).toBeCloseTo(-largest / 2 - ELMOS_PER_FOOTPRINT / 2, 5);
    }
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

  it("reaches under a figure that stands past the default ground", () => {
    // Balanced Annihilation's Krogoth gantry, measured through unitsync: 125
    // elmos wide, which parks its far edge past the ground's default edge.
    const width = 125;
    const farEdge = referenceParkX(width) - width / 2;
    expect(farEdge).toBeLessThan(-GROUND_ELMOS / 2);

    const [, steps] = buildGround(-farEdge).children;
    const size = new THREE.Box3()
      .setFromObject(steps)
      .getSize(new THREE.Vector3());
    expect(size.x / 2).toBeGreaterThanOrEqual(-farEdge);
  });
});

describe("groundSteps", () => {
  it("never lays less ground than the builder has always shown", () => {
    const smallest = GROUND_ELMOS / 2 / ELMOS_PER_FOOTPRINT;
    for (const reach of [0, 1, GROUND_ELMOS / 2]) {
      expect(groundSteps(reach)).toBe(smallest);
    }
  });

  it("grows in whole steps, and always covers the reach asked for", () => {
    for (const reach of [200, 201, 260, 1000]) {
      const steps = groundSteps(reach);
      expect(steps).toBe(Math.ceil(steps));
      expect(steps * ELMOS_PER_FOOTPRINT).toBeGreaterThanOrEqual(reach);
      // And no more than one step of slack, so it does not sprawl.
      expect((steps - 1) * ELMOS_PER_FOOTPRINT).toBeLessThan(reach);
    }
  });
});

describe("disposeGround", () => {
  it("does not throw on freshly built ground", () => {
    expect(() => disposeGround(buildGround())).not.toThrow();
  });
});

describe("buildFrontMarker", () => {
  it("points the arrow at model +z, not some other axis", () => {
    const [arrow] = buildFrontMarker().children.filter(
      (child) => child.name === "front-arrow",
    );
    const box = new THREE.Box3().setFromObject(arrow);
    // Its whole length lies ahead of the origin, along +z, centred on x = 0.
    expect(box.min.z).toBeGreaterThan(0);
    expect(box.max.z).toBeGreaterThan(box.min.z);
    expect(box.min.x + box.max.x).toBeCloseTo(0, 5);
  });

  it("writes the label past the arrow's tip, not on top of it", () => {
    const group = buildFrontMarker();
    const [arrow] = group.children.filter(
      (child) => child.name === "front-arrow",
    );
    const [label] = group.children.filter(
      (child) => child.name === "front-label",
    );
    const arrowTip = new THREE.Box3().setFromObject(arrow).max.z;
    const labelBox = new THREE.Box3().setFromObject(label);
    expect(labelBox.min.z).toBeGreaterThanOrEqual(arrowTip);
  });

  it("lies flat on the ground, like the plates", () => {
    for (const child of buildFrontMarker().children) {
      const box = new THREE.Box3().setFromObject(child);
      expect(box.min.y).toBeGreaterThan(0);
      expect(box.max.y).toBeLessThan(0.1);
    }
  });

  it("draws see-through, like the rest of the ground", () => {
    for (const child of buildFrontMarker().children) {
      const material = (child as THREE.Mesh).material as THREE.Material;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeLessThan(1);
    }
  });
});

describe("disposeFrontMarker", () => {
  it("does not throw on a freshly built marker", () => {
    expect(() => disposeFrontMarker(buildFrontMarker())).not.toThrow();
  });
});
