import { describe, expect, it } from "vitest";
import { layoutNodes, playBounds, playExtentFor } from "./layout";
import {
  CAMERA_CLEARANCE,
  cameraFloorAt,
  clampPanToSheet,
  createTerrainSurface,
  DEFAULT_HEIGHT_SCALE_FRACTION,
  type HeightGrid,
  heightGridFromPixels,
  layoutStrategicMap,
  MARKER_LIFT,
  sampleHeightGrid,
  TERRAIN_SUN,
  terrainCameraLimits,
  terrainNormalPixels,
  terrainSpecOf,
  terrainTriangles,
} from "./terrain";

/** A 3 by 3 grid with a single peak in the middle. */
const peak: HeightGrid = {
  data: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]),
  width: 3,
  height: 3,
};

/** A 2 by 2 grid rising from 0 on the left edge to 1 on the right. */
const ramp: HeightGrid = {
  data: new Float32Array([0, 1, 0, 1]),
  width: 2,
  height: 2,
};

describe("heightGridFromPixels", () => {
  it("reads the red channel of RGBA bytes", () => {
    const grid = heightGridFromPixels({
      data: new Uint8ClampedArray([0, 9, 9, 255, 255, 9, 9, 255]),
      width: 2,
      height: 1,
    });
    expect(Array.from(grid.data)).toEqual([0, 1]);
  });

  it("reads one value per pixel, scaled by what the array can hold", () => {
    const bytes = heightGridFromPixels({
      data: new Uint8Array([0, 255]),
      width: 2,
      height: 1,
    });
    expect(Array.from(bytes.data)).toEqual([0, 1]);
    const words = heightGridFromPixels({
      data: new Uint16Array([0, 65535]),
      width: 2,
      height: 1,
    });
    expect(Array.from(words.data)).toEqual([0, 1]);
    const floats = heightGridFromPixels({
      data: new Float32Array([0.25, 2]),
      width: 2,
      height: 1,
    });
    expect(Array.from(floats.data)).toEqual([0.25, 1]);
    const plain = heightGridFromPixels({ data: [0.5], width: 1, height: 1 });
    expect(Array.from(plain.data)).toEqual([0.5]);
  });

  it("rejects an array of the wrong length and a bad size", () => {
    expect(() =>
      heightGridFromPixels({ data: [0, 0, 0], width: 2, height: 1 }),
    ).toThrow();
    expect(() =>
      heightGridFromPixels({ data: [], width: 0, height: 1 }),
    ).toThrow();
  });
});

describe("sampleHeightGrid", () => {
  it("puts the first and last pixels on the edges of the map", () => {
    expect(sampleHeightGrid(ramp, 0, 0)).toBe(0);
    expect(sampleHeightGrid(ramp, 1, 1)).toBe(1);
    expect(sampleHeightGrid(peak, 0.5, 0.5)).toBe(1);
  });

  it("blends between pixels", () => {
    expect(sampleHeightGrid(ramp, 0.25, 0.5)).toBeCloseTo(0.25);
    expect(sampleHeightGrid(peak, 0.25, 0.5)).toBeCloseTo(0.5);
    expect(sampleHeightGrid(peak, 0.25, 0.25)).toBeCloseTo(0.25);
  });

  it("clamps a point off the map to the nearest edge", () => {
    expect(sampleHeightGrid(ramp, -3, 0.5)).toBe(0);
    expect(sampleHeightGrid(ramp, 7, 0.5)).toBe(1);
  });
});

describe("createTerrainSurface", () => {
  it("maps map units to a centred sheet whose longer side is the extent", () => {
    const s = createTerrainSurface({ width: 2000, height: 1000 }, 100);
    expect(s.scale).toBe(0.05);
    expect(s.worldWidth).toBe(100);
    expect(s.worldDepth).toBe(50);
    // Top left of the picture is the far left corner, map y runs along +Z.
    expect(s.mapToWorldXZ(0, 0)).toEqual([-50, -25]);
    expect(s.mapToWorldXZ(2000, 1000)).toEqual([50, 25]);
    expect(s.mapToWorldXZ(1000, 500)).toEqual([0, 0]);
    expect(s.bounds).toEqual({ minX: -50, maxX: 50, minZ: -25, maxZ: 25 });
  });

  it("maps world positions back to map units", () => {
    const s = createTerrainSurface({ width: 2000, height: 1000 }, 100);
    const [x, z] = s.mapToWorldXZ(350, 720);
    const [mapX, mapY] = s.worldToMap(x, z);
    expect(mapX).toBeCloseTo(350);
    expect(mapY).toBeCloseTo(720);
  });

  it("is flat without a heightmap", () => {
    const s = createTerrainSurface({ width: 800, height: 800 }, 100);
    expect(s.segmentsX).toBe(1);
    expect(s.segmentsY).toBe(1);
    expect(s.maxHeight).toBe(0);
    expect(s.groundHeightAt(400, 400)).toBe(0);
    expect(s.mapToWorld(400, 400)).toEqual([0, 0, 0]);
  });

  it("scales height by heightScale and the same factor as the ground", () => {
    // 1000 map units across 100 world units, a white pixel is 200 map units.
    const s = createTerrainSurface(
      { width: 1000, height: 1000, heightScale: 200 },
      100,
      peak,
    );
    expect(s.groundHeightAt(500, 500)).toBeCloseTo(20);
    expect(s.maxHeight).toBeCloseTo(20);
    expect(s.groundHeightAt(0, 0)).toBe(0);
    expect(s.groundHeightAtWorld(0, 0)).toBeCloseTo(20);
    expect(s.mapToWorld(500, 500, 1.5)).toEqual([0, 21.5, 0]);
  });

  it("defaults heightScale to a fraction of the longer side", () => {
    const s = createTerrainSurface({ width: 1000, height: 400 }, 100, peak);
    expect(s.heightScale).toBe(1000 * DEFAULT_HEIGHT_SCALE_FRACTION);
    expect(s.maxHeight).toBeCloseTo(s.heightScale * s.scale);
  });

  it("reads a position off the sheet as the nearest edge", () => {
    const s = createTerrainSurface(
      { width: 100, height: 100, heightScale: 10 },
      100,
      ramp,
    );
    expect(s.groundHeightAt(-50, 50)).toBe(0);
    expect(s.groundHeightAt(500, 50)).toBeCloseTo(10);
  });

  it("caps the mesh detail and shares it by the map's shape", () => {
    const big: HeightGrid = {
      data: new Float32Array(600 * 300),
      width: 600,
      height: 300,
    };
    const s = createTerrainSurface({ width: 2000, height: 1000 }, 100, big, 64);
    expect(s.segmentsX).toBe(64);
    expect(s.segmentsY).toBe(32);
    expect(s.vertexHeights.length).toBe(65 * 33);
  });

  it("answers the height of the triangles the mesh draws", () => {
    // One cell: only the top right corner is raised. The mesh splits the cell
    // from top right to bottom left, so the top left triangle slopes and the
    // bottom right triangle also slopes, meeting on a diagonal at height 5.
    const corner: HeightGrid = {
      data: new Float32Array([0, 1, 0, 0]),
      width: 2,
      height: 2,
    };
    const s = createTerrainSurface(
      { width: 100, height: 100, heightScale: 10 },
      100,
      corner,
    );
    expect(Array.from(terrainTriangles(1, 1))).toEqual([0, 2, 1, 1, 2, 3]);
    expect(s.groundHeightAt(100, 0)).toBeCloseTo(10);
    expect(s.groundHeightAt(50, 50)).toBeCloseTo(5);
    expect(s.groundHeightAt(50, 0)).toBeCloseTo(5);
    // Inside the bottom right triangle, a quarter of the way in from the
    // diagonal's far corner: (10 * 0.25) by the plane through its vertices.
    expect(s.groundHeightAt(75, 75)).toBeCloseTo(2.5);
    expect(s.groundHeightAt(25, 25)).toBeCloseTo(2.5);
  });
});

describe("terrainNormalPixels", () => {
  const rgba = (bytes: Uint8Array, i: number) =>
    Array.from(bytes.slice(i * 4, i * 4 + 4));

  it("points level ground straight up and carries its height in alpha", () => {
    const grid: HeightGrid = {
      data: new Float32Array(4).fill(0.5),
      width: 2,
      height: 2,
    };
    const s = createTerrainSurface({ width: 100, height: 100 }, 100, grid);
    const bytes = terrainNormalPixels(s, grid);
    expect(bytes.length).toBe(16);
    for (let i = 0; i < 4; i++)
      expect(rgba(bytes, i)).toEqual([128, 255, 128, 128]);
  });

  it("tilts the normal away from the rise", () => {
    const s = createTerrainSurface(
      { width: 100, height: 100, heightScale: 40 },
      100,
      ramp,
    );
    const [r, g, b, a] = rgba(terrainNormalPixels(s, ramp), 1);
    // Rising toward +x, so the normal leans toward -x and not along z.
    expect(r).toBeLessThan(128);
    expect(g).toBeGreaterThan(128);
    expect(b).toBe(128);
    expect(a).toBe(255);
  });

  it("turns the north and west of a peak toward the sun", () => {
    const s = createTerrainSurface(
      { width: 100, height: 100, heightScale: 40 },
      100,
      peak,
    );
    const bytes = terrainNormalPixels(s, peak);
    const facing = (i: number) => {
      const [r, g, b] = rgba(bytes, i).map((v) => v / 127.5 - 1);
      const [sx, sy, sz] = TERRAIN_SUN;
      return r * sx + g * sy + b * sz;
    };
    // North and west of the peak face the sun, south and east face away.
    expect(facing(1)).toBeGreaterThan(facing(7));
    expect(facing(3)).toBeGreaterThan(facing(5));
  });
});

describe("terrain camera limits", () => {
  const s = createTerrainSurface(
    { width: 2000, height: 1000, heightScale: 400 },
    100,
    peak,
  );

  it("allows a straight down view and stops short of the horizon", () => {
    const limits = terrainCameraLimits(s, 50);
    expect(limits.minPolarAngle).toBe(0);
    expect(limits.maxPolarAngle).toBeLessThan(Math.PI / 2);
  });

  it("zooms out far enough to fit the sheet, never less than the galaxy", () => {
    expect(terrainCameraLimits(s, 50).maxDistance).toBe(220);
    const wide = createTerrainSurface({ width: 10, height: 10 }, 400);
    const fit = 400 / (2 * Math.tan((25 * Math.PI) / 180));
    expect(terrainCameraLimits(wide, 50).maxDistance).toBeCloseTo(fit * 1.25);
    expect(terrainCameraLimits(wide, 50).minDistance).toBe(25);
  });

  it("clamps a pan to the sheet", () => {
    expect(clampPanToSheet(s, 0, 0)).toEqual([0, 0]);
    expect(clampPanToSheet(s, 500, -500)).toEqual([50, -25]);
    expect(clampPanToSheet(s, -500, 500)).toEqual([-50, 25]);
  });

  it("keeps the camera a clearance above the ground beneath it", () => {
    expect(cameraFloorAt(s, 0, 0)).toBeCloseTo(20 + CAMERA_CLEARANCE);
    expect(cameraFloorAt(s, -50, -25)).toBe(CAMERA_CLEARANCE);
    // Off the sheet the floor follows the nearest edge.
    expect(cameraFloorAt(s, 900, 0)).toBe(CAMERA_CLEARANCE);
  });
});

describe("terrainSpecOf", () => {
  it("is undefined without a terrain or with an unusable size", () => {
    expect(terrainSpecOf({})).toBeUndefined();
    expect(
      terrainSpecOf({ terrain: { image: "a.png", width: 0, height: 10 } }),
    ).toBeUndefined();
    expect(
      terrainSpecOf({
        terrain: { image: "a.png", width: 10, height: Number.NaN },
      }),
    ).toBeUndefined();
  });

  it("returns a usable terrain", () => {
    const terrain = { image: "a.png", width: 10, height: 20 };
    expect(terrainSpecOf({ terrain })).toBe(terrain);
  });
});

describe("layoutStrategicMap", () => {
  const nodes = [
    { id: "a", pos: [0, 0] as [number, number] },
    { id: "b", pos: [10, 0] as [number, number] },
    { id: "c", pos: [5, 4] as [number, number] },
  ];

  it("lays a galaxy out exactly as layoutNodes does", () => {
    const extent = playExtentFor(nodes.length);
    const expected = layoutNodes(nodes, extent);
    const laid = layoutStrategicMap({ nodes });
    expect(laid.surface).toBeUndefined();
    expect(laid.skin).toBe("galaxy");
    expect(laid.extent).toBe(extent);
    expect(laid.positions).toEqual(expected);
    expect(laid.bounds).toEqual(playBounds(expected.values()));
  });

  it("draws a land style that has no terrain as the flat chart", () => {
    for (const skin of ["cities", "territories"] as const) {
      const laid = layoutStrategicMap({ nodes, theme: { skin } });
      expect(laid.surface).toBeUndefined();
      expect(laid.skin).toBe("theatre");
    }
  });

  it("lays a theatre map out as before, flattened", () => {
    const extent = playExtentFor(nodes.length);
    const expected = layoutNodes(nodes, extent);
    for (const p of expected.values()) p[1] = 0;
    const laid = layoutStrategicMap({ nodes, theme: { skin: "theatre" } });
    expect(laid.surface).toBeUndefined();
    expect(laid.skin).toBe("theatre");
    expect(laid.positions).toEqual(expected);
    expect(laid.bounds).toEqual(playBounds(expected.values()));
  });

  it("takes the old path when the terrain is unusable", () => {
    const laid = layoutStrategicMap({
      nodes,
      terrain: { image: "a.png", width: 0, height: 0 },
    });
    expect(laid.surface).toBeUndefined();
    expect(laid.positions).toEqual(
      layoutNodes(nodes, playExtentFor(nodes.length)),
    );
  });

  it("places nodes on a terrain by map units, at ground height", () => {
    const terrain = {
      image: "a.png",
      width: 1000,
      height: 1000,
      heightScale: 100,
    };
    const laid = layoutStrategicMap(
      {
        nodes: [
          { id: "corner", pos: [0, 0] },
          { id: "summit", pos: [500, 500] },
        ],
        terrain,
        theme: { skin: "galaxy" },
      },
      peak,
    );
    const extent = playExtentFor(2);
    expect(laid.surface).toBeDefined();
    expect(laid.skin).toBe("theatre");
    expect(laid.bounds).toEqual(laid.surface?.bounds);
    const corner = laid.positions.get("corner");
    const summit = laid.positions.get("summit");
    expect(corner?.[0]).toBeCloseTo(-extent / 2);
    expect(corner?.[1]).toBeCloseTo(MARKER_LIFT);
    expect(corner?.[2]).toBeCloseTo(-extent / 2);
    expect(summit?.[0]).toBeCloseTo(0);
    expect(summit?.[1]).toBeCloseTo((100 * extent) / 1000 + MARKER_LIFT);
    expect(summit?.[2]).toBeCloseTo(0);
  });

  it("is flat on a terrain with no heights", () => {
    const laid = layoutStrategicMap({
      nodes: [{ id: "n", pos: [250, 750] }],
      terrain: { image: "a.png", width: 1000, height: 1000 },
    });
    expect(laid.surface?.maxHeight).toBe(0);
    expect(laid.positions.get("n")?.[1]).toBe(MARKER_LIFT);
  });
});
