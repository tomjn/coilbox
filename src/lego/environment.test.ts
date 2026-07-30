import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GROUND_ELMOS } from "./buildPlate";
import {
  BACKDROPS,
  backdropById,
  buildTerrain,
  disposeTerrain,
  GROUND_SURFACES,
  groundById,
  skyTexture,
  TERRAIN_ELMOS,
  terrainAlpha,
} from "./environment";

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

  it("does not throw when freed", () => {
    expect(() => disposeTerrain(buildTerrain())).not.toThrow();
  });
});
