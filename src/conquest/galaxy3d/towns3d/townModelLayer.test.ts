import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createTerrainSurface, type HeightGrid } from "../terrain";
import { CAPITAL_RADIUS, planTowns, withStreets } from "../towns";
import { OPEN_GRID, RIVER_BANK, SEALED_GRID } from "./layout";
import { buildTownModelLayer, shadowSide } from "./townModelLayer";

const SIDE = 101;
const surfaceAt = (level: number) => {
  const grid: HeightGrid = {
    data: new Float32Array(SIDE * SIDE).fill(level),
    width: SIDE,
    height: SIDE,
  };
  return createTerrainSurface(
    { width: 100, height: 100, heightScale: 10 },
    200,
    grid,
  );
};

const build = (
  opts: {
    level?: number;
    omit?: ReadonlySet<number>;
    planet?: Parameters<typeof buildTownModelLayer>[5];
    riverEdge?: (x: number, z: number) => number;
  } = {},
) => {
  const surface = surfaceAt(opts.level ?? 0.5);
  const sites = [
    [20, 50],
    [50, 50],
    [80, 50],
  ].map(([mx, mz], k) => {
    const [x, z] = surface.mapToWorldXZ(mx, mz);
    return { x, z, capital: k === 0, roads: [0, Math.PI] };
  });
  const towns = withStreets(planTowns(sites, 7), [
    [0, Math.PI],
    [0, Math.PI],
    [0, Math.PI],
  ]);
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const layer = buildTownModelLayer(
    scene,
    disposables,
    surface,
    towns,
    opts.omit ?? new Set(),
    opts.planet,
    opts.riverEdge,
  );
  return { scene, disposables, layer, surface, towns };
};

const meshes = (scene: THREE.Scene) => {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
};

/** The nth town's building material, by the order the towns were added. */
const materialOf = (scene: THREE.Scene, n: number) => {
  const groups = scene.children.filter((o) => o instanceof THREE.Group);
  return (groups[n].children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
};

/** The nth town's ground decal, the shader sheet outside any group. */
const decalOf = (scene: THREE.Scene, n: number) => {
  const decals = scene.children.filter(
    (o) =>
      o instanceof THREE.Mesh &&
      (o.material as THREE.ShaderMaterial).uniforms?.uRingStrength,
  ) as THREE.Mesh[];
  return decals[n].material as THREE.ShaderMaterial;
};

const sheets = (scene: THREE.Scene) =>
  scene.children.filter(
    (o) =>
      o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial,
  ) as THREE.Mesh[];

describe("buildTownModelLayer", () => {
  it("builds a mesh, a street sheet and a decal for each town", () => {
    const { scene, layer } = build();
    expect([...layer.nodes]).toEqual([0, 1, 2]);
    expect(scene.children.filter((o) => o instanceof THREE.Group)).toHaveLength(
      3,
    );
    expect(sheets(scene)).toHaveLength(3);
    const decals = scene.children.filter(
      (o) =>
        o instanceof THREE.Mesh &&
        (o.material as THREE.ShaderMaterial).uniforms?.uRingStrength,
    );
    expect(decals).toHaveLength(3);
  });

  it("names a town's group, sheet and decal town-models", () => {
    const { scene } = build();
    const groups = scene.children.filter((o) => o instanceof THREE.Group);
    expect(groups).toHaveLength(3);
    for (const g of groups) expect(g.name).toBe("town-models");
    const decals = scene.children.filter(
      (o) =>
        o instanceof THREE.Mesh &&
        (o.material as THREE.ShaderMaterial).uniforms?.uRingStrength,
    );
    expect(decals).toHaveLength(3);
    for (const d of decals) expect(d.name).toBe("town-models");
    for (const s of sheets(scene)) expect(s.name).toBe("town-models");
  });

  it("draws the ring one lot outside the town's furthest edge", () => {
    for (const [planet, grid] of [
      [undefined, OPEN_GRID],
      ["moon", SEALED_GRID],
    ] as const) {
      const { scene, towns } = build({ planet });
      towns.forEach((town, n) => {
        const u = decalOf(scene, n).uniforms;
        expect(u.uRingRadius.value).toBeCloseTo(
          town.radius * 1.27 + grid.lot,
          6,
        );
      });
    }
  });

  it("fades a town's street sheet to nothing on its outer boundary", () => {
    const { scene } = build();
    for (const sheet of sheets(scene)) {
      const colour = sheet.geometry.getAttribute("color");
      const n = Math.sqrt(colour.count) - 1;
      expect(Number.isInteger(n)).toBe(true);
      for (let k = 0; k <= n; k++)
        for (const [i, j] of [
          [k, 0],
          [k, n],
          [0, k],
          [n, k],
        ])
          expect(colour.getW(j * (n + 1) + i)).toBe(0);
    }
  });

  it("lets a river show through the street sheet", () => {
    const dry = build();
    const z0 = dry.towns[0].z;
    const wet = build({ riverEdge: (_x, z) => Math.abs(z - z0) - 0.1 });
    // The vertices of the first sheet, near the town's heart, as [alpha, dz].
    const near = (b: ReturnType<typeof build>) => {
      const town = b.towns[0];
      const sheet = sheets(b.scene)[0].geometry;
      const pos = sheet.getAttribute("position");
      const col = sheet.getAttribute("color");
      const out: [number, number][] = [];
      for (let k = 0; k < pos.count; k++) {
        const dx = pos.getX(k) - town.x;
        const dz = pos.getZ(k) - town.z;
        if (Math.hypot(dx, dz) < town.radius * 0.5)
          out.push([col.getW(k), Math.abs(dz)]);
      }
      return out;
    };
    const inWater = near(wet).filter(([, dz]) => dz < 0.1);
    expect(inWater.length).toBeGreaterThan(0);
    for (const [alpha] of inWater) expect(alpha).toBe(0);
    const clear = near(wet).filter(([, dz]) => dz > 0.1 + RIVER_BANK);
    expect(clear.length).toBeGreaterThan(0);
    for (const [alpha] of clear) expect(alpha).toBeGreaterThan(0);
    // With no river the same vertices are drawn.
    const same = near(dry).filter(([, dz]) => dz < 0.1);
    expect(same.length).toBe(inWater.length);
    for (const [alpha] of same) expect(alpha).toBeGreaterThan(0);
  });

  it("leaves out a town a landmark stands in place of", () => {
    const { layer } = build({ omit: new Set([1]) });
    expect([...layer.nodes]).toEqual([0, 2]);
  });

  it("reports a top above the ground for each town", () => {
    const { layer, surface, towns } = build();
    for (const town of towns) {
      const ground = surface.groundHeightAtWorld(town.x, town.z);
      expect(layer.tops.get(town.node)).toBeGreaterThan(ground);
    }
  });

  it("dims a town hidden by fog", () => {
    const { scene, layer } = build();
    layer.setStyle(0, { hidden: true });
    expect(materialOf(scene, 0).uniforms.uHidden.value).toBe(1);
    expect(materialOf(scene, 1).uniforms.uHidden.value).toBe(0);
    const sheet = sheets(scene)[0].material as THREE.MeshBasicMaterial;
    expect(sheet.color.r).toBeCloseTo(0.7, 5);
    layer.setStyle(0, { hidden: false });
    expect(sheet.color.r).toBe(1);
  });

  it("draws a ring", () => {
    const { scene, layer } = build();
    layer.setStyle(0, {
      hidden: false,
      ring: { color: new THREE.Color(1, 1, 1), strength: 0.9, thick: true },
    });
    expect(decalOf(scene, 0).uniforms.uRingStrength.value).toBe(0.9);
  });

  it("ignores a node with no town built", () => {
    const { layer } = build({ omit: new Set([1]) });
    expect(() => layer.setStyle(1, { hidden: true })).not.toThrow();
  });

  it("draws the street sheet as a transparent decal between the fills and the shadow", () => {
    const { scene } = build();
    for (const sheet of sheets(scene)) {
      const m = sheet.material as THREE.MeshBasicMaterial;
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.polygonOffsetFactor).toBe(-1);
      expect(m.polygonOffsetUnits).toBe(-2);
      expect(sheet.renderOrder).toBe(-2.45);
    }
  });

  it("takes the decal's shadow far enough for the tallest building", () => {
    const { scene } = build();
    const u = (decalOf(scene, 0) as THREE.ShaderMaterial).uniforms;
    expect(u.uShadowReach.value).toBeGreaterThan(u.uReach.value);
    expect(u.uContact.value).toBe(0);
  });

  it("skips a town with nowhere to build", () => {
    const { scene, layer } = build({ level: 0 });
    expect(layer.nodes.size).toBe(0);
    expect(layer.tops.size).toBe(0);
    expect(layer.shadowBytes).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it("uses the temperate palette and the open grid with no planet", () => {
    const plain = build();
    const temperate = build({ planet: "temperate" });
    expect([...plain.layer.nodes]).toEqual([...temperate.layer.nodes]);
    expect(plain.layer.shadowBytes).toBe(temperate.layer.shadowBytes);
    for (const [node, top] of plain.layer.tops)
      expect(temperate.layer.tops.get(node)).toBe(top);
  });

  it("never picks its meshes", () => {
    const { scene } = build();
    const hits: THREE.Intersection[] = [];
    for (const mesh of meshes(scene)) mesh.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
    expect(meshes(scene).length).toBeGreaterThan(0);
  });

  it("puts everything it makes in disposables", () => {
    const { scene, disposables } = build();
    const held = new Set<unknown>(disposables);
    for (const mesh of meshes(scene)) {
      expect(held.has(mesh.geometry)).toBe(true);
      expect(held.has(mesh.material)).toBe(true);
    }
    const targets = disposables.filter(
      (d) => d instanceof THREE.WebGLRenderTarget,
    ) as THREE.WebGLRenderTarget[];
    expect(targets).toHaveLength(3);
    for (const t of targets) expect(held.has(t.depthTexture)).toBe(true);
  });

  it("counts the shadow texture it holds", () => {
    const { layer, towns } = build();
    let bytes = 0;
    for (const t of towns) bytes += 8 * shadowSide(t.radius) ** 2;
    expect(layer.shadowBytes).toBe(bytes);
  });
});

describe("shadowSide", () => {
  it("sizes a town's shadow by its radius", () => {
    expect(shadowSide(CAPITAL_RADIUS)).toBe(1024);
    expect(shadowSide(CAPITAL_RADIUS * 2)).toBe(1024);
    expect(shadowSide(0.9)).toBe(256);
    expect(shadowSide(1.3)).toBe(370);
  });
});
