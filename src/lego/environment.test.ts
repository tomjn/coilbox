import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GROUND_ELMOS } from "./buildPlate";
import { type DriveMotion, driveAlong, driveReach, pathPoints } from "./drive";
import {
  BACKDROPS,
  backdropById,
  buildShapedTerrain,
  buildTerrain,
  buildWater,
  DEFAULT_GROUND,
  disposeTerrain,
  footprintWidth,
  GROUND_SURFACES,
  groundById,
  groundHeight,
  groundNormal,
  groundShape,
  reshapeTerrain,
  skyTexture,
  TERRAIN_ELMOS,
  terrainAlpha,
  terrainScale,
  unitUp,
  validGroundDegrees,
} from "./environment";
import { PREVIEW_FRAMES } from "./scriptPlayback";

describe("the options", () => {
  it("opens on the view the builder has always had", () => {
    expect(BACKDROPS[0].id).toBe("studio");
    expect(BACKDROPS[0].stops).toEqual([]);
    expect(GROUND_SURFACES[0].id).toBe("grid");
  });

  it("names each one once", () => {
    const ids = [
      ...BACKDROPS.map((backdrop) => backdrop.id),
      ...GROUND_SURFACES.map((ground) => ground.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to the plain view for an id it does not know", () => {
    expect(backdropById("sky").id).toBe("sky");
    expect(backdropById("nonsense")).toBe(BACKDROPS[0]);
    expect(groundById("terrain").id).toBe("terrain");
    expect(groundById("water").id).toBe("water");
    expect(groundById("nonsense")).toBe(GROUND_SURFACES[0]);
  });
});

describe("the sky", () => {
  it("runs top to bottom, with a stop on the horizon", () => {
    for (const backdrop of BACKDROPS) {
      if (backdrop.stops.length === 0) continue;
      const offsets = backdrop.stops.map((stop) => stop.at);
      expect(offsets[0]).toBe(0);
      expect(offsets[offsets.length - 1]).toBe(1);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
      expect(offsets).toContain(0.5);
    }
  });

  it("has nothing to draw for the plain backdrop", () => {
    expect(skyTexture(BACKDROPS[0])).toBe(null);
  });
});

describe("terrainAlpha", () => {
  it("is solid under the whole grid", () => {
    expect(terrainAlpha(0)).toBe(1);
    expect(terrainAlpha(GROUND_ELMOS / 2)).toBe(1);
  });

  it("has faded to nothing by the rim", () => {
    expect(terrainAlpha(TERRAIN_ELMOS / 2)).toBe(0);
    expect(terrainAlpha(TERRAIN_ELMOS)).toBe(0);
  });

  it("fades without ever going back up", () => {
    let last = 1;
    for (let elmos = 0; elmos <= TERRAIN_ELMOS; elmos += 4) {
      const alpha = terrainAlpha(elmos);
      expect(alpha).toBeLessThanOrEqual(last);
      expect(alpha).toBeGreaterThanOrEqual(0);
      last = alpha;
    }
    // Half way through the fade is half way through the fade.
    expect(terrainAlpha(GROUND_ELMOS * 0.75)).toBeCloseTo(0.5, 5);
  });
});

describe("buildTerrain", () => {
  it("covers the whole grid and lies just under it", () => {
    const box = new THREE.Box3().setFromObject(buildTerrain());
    expect(box.max.x - box.min.x).toBeCloseTo(TERRAIN_ELMOS, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(TERRAIN_ELMOS, 5);
    expect(box.max.y).toBeLessThan(0);
    expect(box.max.y).toBeGreaterThan(-0.1);
  });

  it("is see-through at the rim and never in the way of a click", () => {
    const mesh = buildTerrain();
    expect((mesh.material as THREE.MeshBasicMaterial).transparent).toBe(true);
    expect(mesh.renderOrder).toBeLessThan(0);
    const hits: THREE.Intersection[] = [];
    mesh.raycast(new THREE.Raycaster(), hits);
    expect(hits).toEqual([]);
  });

  it("frees its geometry and material when freed", () => {
    const mesh = buildTerrain();
    const geometry = vi.spyOn(mesh.geometry, "dispose");
    const material = vi.spyOn(mesh.material as THREE.Material, "dispose");

    disposeTerrain(mesh);

    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
  });
});

// The same numbers `crates/coilbox-unitpose/src/ground.rs` checks, so the
// ground a script is told about is the ground drawn.
describe("groundHeight", () => {
  it("rises ahead of the unit on a slope", () => {
    const slope = { kind: "slope", degrees: 45 } as const;
    expect(groundHeight(slope, 0, 0)).toBeCloseTo(0, 9);
    expect(groundHeight(slope, 30, 10)).toBeCloseTo(10, 9);
    expect(groundHeight(slope, 0, -20)).toBeCloseTo(-20, 9);
  });

  it("is level with the unit at the origin on uneven ground", () => {
    const uneven = { kind: "uneven", degrees: 45, width: 64 } as const;
    const top = 64 / (2 * Math.PI);
    expect(groundHeight(uneven, 0, 0)).toBeCloseTo(0, 9);
    expect(groundHeight(uneven, 16, 0)).toBeCloseTo(top, 9);
    expect(groundHeight(uneven, -16, 0)).toBeCloseTo(-top, 9);
    expect(groundHeight(uneven, 16, 32)).toBeCloseTo(-top, 9);
  });
});

describe("groundNormal", () => {
  it("leans back down a slope", () => {
    const [x, y, z] = groundNormal({ kind: "slope", degrees: 30 }, 5, 5);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(z).toBeCloseTo(-Math.sin(Math.PI / 6), 9);
  });

  it("is as steep as asked under the unit on uneven ground", () => {
    const [x, y, z] = groundNormal(
      { kind: "uneven", degrees: 30, width: 32 },
      0,
      0,
    );
    expect(x).toBeCloseTo(-Math.sin(Math.PI / 6), 9);
    expect(y).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(z).toBeCloseTo(0, 9);
  });

  it("is straight up on top of a bump", () => {
    const normal = groundNormal(
      { kind: "uneven", degrees: 30, width: 32 },
      8,
      0,
    );
    expect(normal[0]).toBeCloseTo(0, 9);
    expect(normal[1]).toBeCloseTo(1, 9);
  });
});

describe("unitUp", () => {
  const slope = { kind: "slope", degrees: 30 } as const;

  it("turns a unit that is not upright to the ground under it", () => {
    expect(unitUp(slope, false)).toEqual(groundNormal(slope, 0, 0));
  });

  it("leaves an upright unit, and any unit on flat ground, alone", () => {
    expect(unitUp(slope, true)).toBe(null);
    expect(unitUp(null, false)).toBe(null);
  });
});

describe("groundShape", () => {
  it("is flat for the grounds with no height in them", () => {
    for (const id of ["grid", "terrain", "water"] as const)
      expect(groundShape({ ...DEFAULT_GROUND, id }, 32)).toBe(null);
  });

  it("sizes uneven ground to the unit until a width is chosen", () => {
    const choice = { ...DEFAULT_GROUND, id: "uneven" as const, degrees: 10 };
    expect(groundShape(choice, 48)).toEqual({
      kind: "uneven",
      degrees: 10,
      width: 48,
    });
    expect(groundShape({ ...choice, width: 80 }, 48)).toEqual({
      kind: "uneven",
      degrees: 10,
      width: 80,
    });
  });

  it("opens on flat ground", () => {
    expect(DEFAULT_GROUND.id).toBe("grid");
  });
});

describe("footprintWidth", () => {
  it("is the larger side of the unit's footprint, in elmos", () => {
    const bounds = {
      mid: [0, 0, 0] as [number, number, number],
      sizeX: 20,
      sizeY: 5,
      sizeZ: 40,
    };
    expect(footprintWidth(bounds)).toBe(48);
  });
});

describe("validGroundDegrees", () => {
  it("takes level up to just short of a wall", () => {
    expect(validGroundDegrees(0)).toBe(true);
    expect(validGroundDegrees(89.9)).toBe(true);
    expect(validGroundDegrees(90)).toBe(false);
    expect(validGroundDegrees(-1)).toBe(false);
    expect(validGroundDegrees(Number.NaN)).toBe(false);
  });
});

describe("buildShapedTerrain", () => {
  function heightsMatch(
    mesh: THREE.Mesh,
    shape: Parameters<typeof groundHeight>[0],
  ) {
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBeCloseTo(
        groundHeight(shape, position.getX(i), position.getZ(i)),
        1,
      );
    }
  }

  it("draws the height a script is told about", () => {
    const shape = { kind: "uneven", degrees: 20, width: 64 } as const;
    heightsMatch(buildShapedTerrain(shape), shape);
  });

  it("takes a new shape without a new texture", () => {
    const mesh = buildShapedTerrain({ kind: "slope", degrees: 10 });
    const material = mesh.material;
    const shape = { kind: "slope", degrees: 40 } as const;
    reshapeTerrain(mesh, shape);
    expect(mesh.material).toBe(material);
    heightsMatch(mesh, shape);
  });

  it("is never in the way of a click", () => {
    const mesh = buildShapedTerrain({ kind: "slope", degrees: 10 });
    const hits: THREE.Intersection[] = [];
    mesh.raycast(new THREE.Raycaster(), hits);
    expect(hits).toEqual([]);
    expect(mesh.renderOrder).toBeLessThan(0);
  });
});

// Issue #4158: a unit driving away from the origin left the drawn ground.
describe("ground under a drive", () => {
  /** 60 elmos a second, the speed the issue saw a unit leave the ground at. */
  const MOTION: DriveMotion = { speed: 2, turnRate: 600 };
  const shapes: Parameters<typeof buildShapedTerrain>[0][] = [
    { kind: "slope", degrees: 10 },
    { kind: "uneven", degrees: 10, width: 48 },
  ];

  for (const name of ["straight", "bend", "circle"] as const) {
    const points = pathPoints(name, MOTION, []);
    const run = driveAlong(points, MOTION, {
      start: 15,
      frames: PREVIEW_FRAMES,
      ground: null,
      tilts: false,
      minScriptChangeHeading: 1,
    });
    const reach = driveReach(points, run.frames);
    const scale = terrainScale(reach);

    /** Every frame is over solid ground inside the mesh's own extent. */
    function covers(mesh: THREE.Mesh) {
      mesh.updateMatrixWorld();
      const box = new THREE.Box3().setFromObject(mesh);
      for (const { pos } of run.frames) {
        expect(pos[0]).toBeGreaterThanOrEqual(box.min.x);
        expect(pos[0]).toBeLessThanOrEqual(box.max.x);
        expect(pos[2]).toBeGreaterThanOrEqual(box.min.z);
        expect(pos[2]).toBeLessThanOrEqual(box.max.z);
        expect(terrainAlpha(Math.hypot(pos[0], pos[2]), scale)).toBe(1);
      }
    }

    it(`keeps the flat terrain under the ${name} path`, () => {
      covers(buildTerrain(reach));
    });

    it(`keeps the sea under the ${name} path`, () => {
      covers(buildWater(reach));
    });

    for (const shape of shapes) {
      it(`keeps ${shape.kind} ground under the ${name} path`, () => {
        covers(buildShapedTerrain(shape, reach));
        const mesh = buildShapedTerrain(shape);
        reshapeTerrain(mesh, shape, reach);
        covers(mesh);
      });
    }
  }

  it("draws the default ground when nothing drives", () => {
    const box = new THREE.Box3().setFromObject(buildTerrain(0));
    expect(box.max.x - box.min.x).toBeCloseTo(TERRAIN_ELMOS, 5);
    expect(terrainScale(GROUND_ELMOS / 2)).toBe(1);
  });
});

// Issue #4160: a fast unit's reach made the uneven ground millions of points.
describe("uneven ground over a long reach", () => {
  const shape = { kind: "uneven", degrees: 10, width: 48 } as const;
  const points = (mesh: THREE.Mesh) =>
    mesh.geometry.getAttribute("position").count;

  it("bounds the points however far the unit reaches", () => {
    expect(points(buildShapedTerrain(shape, 1600))).toBeLessThanOrEqual(
      513 * 513,
    );
    expect(points(buildShapedTerrain(shape, 100000))).toBe(
      points(buildShapedTerrain(shape, 1600)),
    );
  });

  it("keeps full detail on the ground a unit that goes nowhere gets", () => {
    expect(points(buildShapedTerrain(shape))).toBe(46225);
  });

  it("still covers the reach", () => {
    const box = new THREE.Box3().setFromObject(buildShapedTerrain(shape, 1600));
    expect(box.max.x).toBeGreaterThanOrEqual(1600);
    expect(box.min.z).toBeLessThanOrEqual(-1600);
  });
});
