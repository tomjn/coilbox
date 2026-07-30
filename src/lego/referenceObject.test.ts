import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildReferenceFigure,
  disposeReferenceFigure,
  REFERENCE_HEIGHT_ELMOS,
} from "./referenceObject";
import { ELMOS_PER_FOOTPRINT } from "./unitDef";

describe("REFERENCE_HEIGHT_ELMOS", () => {
  it("is unitDef's own footprint step, not a copy of the number", () => {
    expect(REFERENCE_HEIGHT_ELMOS).toBe(ELMOS_PER_FOOTPRINT);
  });
});

describe("buildReferenceFigure", () => {
  it("stands exactly one footprint step tall, base at y = 0", () => {
    const box = new THREE.Box3().setFromObject(buildReferenceFigure());
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(REFERENCE_HEIGHT_ELMOS, 5);
  });

  it("stands on a tile a footprint step wide and deep", () => {
    const box = new THREE.Box3().setFromObject(buildReferenceFigure());
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(REFERENCE_HEIGHT_ELMOS, 5);
    expect(size.z).toBeCloseTo(REFERENCE_HEIGHT_ELMOS, 5);
  });

  it("is centred on its own local origin in x and z", () => {
    const box = new THREE.Box3().setFromObject(buildReferenceFigure());
    expect(box.min.x + box.max.x).toBeCloseTo(0, 5);
    expect(box.min.z + box.max.z).toBeCloseTo(0, 5);
  });
});

describe("disposeReferenceFigure", () => {
  it("does not throw on a freshly built figure", () => {
    expect(() => disposeReferenceFigure(buildReferenceFigure())).not.toThrow();
  });
});
