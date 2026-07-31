import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { UnitModelGroup, UnitModelResult } from "../content/bindings";
import model from "./reference/armsolar.json";
import {
  buildGameReferenceUnit,
  buildReferenceUnit,
  disposeReferenceUnit,
  REFERENCE_FOOTPRINT_STEPS,
  REFERENCE_WIDTH_ELMOS,
} from "./referenceObject";
import { ELMOS_PER_FOOTPRINT } from "./unitDef";

/**
 * The reference object exists to be the right size, so these are the sizes,
 * written out as numbers rather than derived from the asset. Measured with
 * `bun run lego:reads3o` over Beyond All Reason's `objects3d/Units/armsolar.s3o`
 * and reported by `scripts/reference-model.mjs` on the conversion. The
 * footprint steps come from `footprintx` and `footprintz` in that game's
 * `units/ArmBuildings/LandEconomy/armsolar.lua`.
 *
 * A rescale, a truncated asset or a swapped model fails here rather than
 * quietly telling someone their unit is the wrong size.
 */
const MODEL_WIDTH_ELMOS = 42.983;
const MODEL_HEIGHT_ELMOS = 29.119;
const FOOTPRINT_STEPS = 5;

/** The unit's own mesh, without the footprint outline drawn around it. */
function unitBox(): THREE.Box3 {
  const group = buildReferenceUnit();
  const mesh = group.children.find((child) => child instanceof THREE.Mesh);
  if (!mesh) throw new Error("no mesh in the reference unit");
  return new THREE.Box3().setFromObject(mesh);
}

describe("the reference model asset", () => {
  it("is the solar collector, credited and licensed", () => {
    expect(model.author).toBe("Cremuss");
    expect(model.licence).toContain("CC-BY-SA-4.0");
    expect(model.source).toContain("armsolar.s3o");
  });

  it("carries the unit's own footprint", () => {
    expect(model.footprintSteps).toBe(FOOTPRINT_STEPS);
  });

  it("is whole triangles addressing vertices that exist", () => {
    const vertexCount = model.positions.length / 3;
    expect(model.normals.length).toBe(model.positions.length);
    expect(model.indices.length % 3).toBe(0);
    expect(Math.max(...model.indices)).toBeLessThan(vertexCount);
  });
});

describe("buildReferenceUnit", () => {
  it("is the solar collector's real height, standing on y = 0", () => {
    const box = unitBox();
    // The model dips 0.088 elmos below its own origin, as the file has it.
    // Nothing here moves it: the origin is the ground plane in game too.
    expect(box.min.y).toBeGreaterThan(-0.1);
    expect(box.min.y).toBeLessThanOrEqual(0);
    expect(box.max.y).toBeCloseTo(MODEL_HEIGHT_ELMOS, 2);
  });

  it("is the solar collector's real width and depth", () => {
    const size = unitBox().getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(MODEL_WIDTH_ELMOS, 2);
    expect(size.z).toBeCloseTo(MODEL_WIDTH_ELMOS, 2);
  });

  it("knows the footprint the engine reserves, wider than the model", () => {
    // Drawn by buildPlate.ts as the largest plate, not drawn twice here.
    expect(REFERENCE_FOOTPRINT_STEPS).toBe(FOOTPRINT_STEPS);
    expect(REFERENCE_FOOTPRINT_STEPS * ELMOS_PER_FOOTPRINT).toBeGreaterThan(
      MODEL_WIDTH_ELMOS,
    );
  });

  it("measures its own width off the geometry", () => {
    expect(REFERENCE_WIDTH_ELMOS).toBeCloseTo(MODEL_WIDTH_ELMOS, 2);
  });

  it("is centred on its own local origin in x and z", () => {
    const box = unitBox();
    // Not exactly: the model is a tenth of an elmo off centre, and squaring
    // that up would be moving vertices to flatter an assertion.
    expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(0.2);
    expect(Math.abs(box.min.z + box.max.z)).toBeLessThan(0.2);
  });

  it("is see-through, so nothing reads it as a piece", () => {
    const group = buildReferenceUnit();
    for (const child of group.children) {
      const material = (child as THREE.Mesh).material as THREE.Material;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeLessThan(1);
    }
  });
});

/**
 * A model as the worker hands one over: two pieces, the second offset from the
 * first, and no texture, so nothing here goes looking for an image file. Sized
 * so the piece offset matters to the width: 10 elmos of quad at the root and
 * another 10 parked 30 elmos out is 50 across, not 20.
 */
function gameModel(): UnitModelResult {
  const quad = (): UnitModelGroup => ({
    positions: [-5, 0, 0, 5, 0, 0, 5, 8, 0, -5, 8, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
  });
  return {
    format: "s3o",
    path: "objects3d/test.s3o",
    radius: 0,
    height: 0,
    mid: [0, 0, 0],
    root: {
      name: "base",
      offset: [0, 0, 0],
      groups: [quad()],
      children: [
        { name: "arm", offset: [30, 0, 0], groups: [quad()], children: [] },
      ],
    },
    textures: [],
    paletteFaces: 0,
    errors: [],
  };
}

describe("buildGameReferenceUnit", () => {
  it("stands the model at the size the file states, in elmos", () => {
    const built = buildGameReferenceUnit(gameModel());
    const box = new THREE.Box3().setFromObject(built.group);
    // Nothing is rescaled between the archive and this scene, so a piece 10
    // elmos wide 30 elmos out is 40 elmos from the far edge of the first.
    expect(box.min.x).toBeCloseTo(-5, 5);
    expect(box.max.x).toBeCloseTo(35, 5);
    expect(box.max.y).toBeCloseTo(8, 5);
    expect(built.widthElmos).toBeCloseTo(40, 5);
    built.dispose();
  });

  it("cannot be clicked, hovered or seated against", () => {
    const built = buildGameReferenceUnit(gameModel());
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 4, 50),
      new THREE.Vector3(0, 0, -1),
    );
    expect(raycaster.intersectObject(built.group, true)).toHaveLength(0);
    built.dispose();
  });

  it("has nothing to build from a model with no pieces", () => {
    const built = buildGameReferenceUnit({ ...gameModel(), root: undefined });
    expect(built.group.children).toHaveLength(0);
    expect(built.widthElmos).toBe(0);
    expect(() => built.dispose()).not.toThrow();
  });
});

describe("disposeReferenceUnit", () => {
  it("does not throw on a freshly built unit", () => {
    expect(() => disposeReferenceUnit(buildReferenceUnit())).not.toThrow();
  });
});
