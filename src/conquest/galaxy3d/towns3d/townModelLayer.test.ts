import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createTerrainSurface, type HeightGrid } from "../terrain";
import { CAPITAL_RADIUS, planTowns, withStreets } from "../towns";
import { OPEN_GRID, RIVER_BANK } from "./layout";
import { buildOutpost } from "./outposts";
import { buildTownModelLayer, groundUnder, shadowSide } from "./townModelLayer";

// Counted, to show each structure is built once in each colourway.
vi.mock("./outposts", async (original) => {
  const real = await original<typeof import("./outposts")>();
  return { ...real, buildOutpost: vi.fn(real.buildOutpost) };
});

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
    outposts?: ReadonlySet<number>;
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
    opts.outposts,
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

  it("draws the ring at the radius it reports", () => {
    for (const planet of [undefined, "moon"] as const) {
      const { scene, layer, towns } = build({ planet });
      towns.forEach((town, n) => {
        const u = decalOf(scene, n).uniforms;
        expect(u.uRingRadius.value).toBeCloseTo(
          layer.rings.get(town.node) as number,
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

  it("reports a ring outside each town's furthest building", () => {
    const { scene, layer, towns } = build();
    for (const town of towns) {
      const group = scene.children.find(
        (o) =>
          o instanceof THREE.Group &&
          o.position.x === town.x &&
          o.position.z === town.z,
      );
      const pos = (group?.children[0] as THREE.Mesh).geometry.getAttribute(
        "position",
      );
      let far = 0;
      for (let i = 0; i < pos.count; i++)
        far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)));
      expect(layer.rings.get(town.node)).toBeGreaterThan(far + 0.25 - 1e-6);
      // One lot, and at most half a building's diagonal of slack.
      expect(layer.rings.get(town.node)).toBeLessThan(far + 1);
    }
  });

  /** The meshes that draw street trees: the ones a tree material draws. */
  const streetTreeMeshes = (scene: THREE.Scene) =>
    scene.children.filter(
      (o) =>
        o instanceof THREE.Mesh &&
        (o.material as THREE.ShaderMaterial).uniforms?.uForest,
    ) as THREE.Mesh[];

  it("plants an open town's streets, and leaves a sealed outpost's bare", () => {
    const open = build();
    const trees = streetTreeMeshes(open.scene);
    expect(trees.length).toBeGreaterThan(0);
    let count = 0;
    for (const m of trees) {
      expect(m.name).toBe("town-models");
      count += (m.geometry as THREE.InstancedBufferGeometry).instanceCount;
    }
    expect(count).toBeGreaterThan(50);
    expect(streetTreeMeshes(build({ planet: "moon" }).scene)).toHaveLength(0);
  });

  it("draws the town's grid on its street sheet", () => {
    const { scene } = build();
    for (const sheet of sheets(scene)) {
      const m = sheet.material as THREE.MeshBasicMaterial;
      expect(m.customProgramCacheKey()).toBe("town-street-ground");
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: "#include <project_vertex>",
        fragmentShader: "#include <color_fragment>",
      };
      m.onBeforeCompile(shader as never, null as never);
      expect(shader.fragmentShader).toContain("townGround()");
      expect(shader.vertexShader).toContain("vTownWorld =");
      expect(shader.uniforms.uTownGrid.value).toEqual(
        new THREE.Vector4(
          OPEN_GRID.lot,
          OPEN_GRID.street,
          OPEN_GRID.avenue,
          OPEN_GRID.boulevard,
        ),
      );
    }
  });

  it("draws no street sheet under a sealed outpost", () => {
    for (const planet of ["moon", "red", "volcanic", "acid"] as const) {
      const { scene, layer } = build({ planet });
      expect(layer.nodes.size, planet).toBeGreaterThan(0);
      expect(sheets(scene), planet).toHaveLength(0);
    }
  });

  it("builds an outpost among open towns where the map asks for one", () => {
    const { scene, layer } = build({ outposts: new Set([1]) });
    expect(layer.nodes.size).toBe(3);
    // The two open towns keep their street sheets. The outpost has none, and
    // stands on striped plates in fresh paint.
    expect(sheets(scene)).toHaveLength(2);
    const groups = scene.children.filter((o) => o instanceof THREE.Group);
    const kinds = groups.map((g) =>
      Array.from(
        (g.children[0] as THREE.Mesh).geometry.getAttribute("kind").array,
      ),
    );
    expect(kinds.map((k) => k.includes(14))).toEqual([false, true, false]);
    expect(materialOf(scene, 1).defines).toEqual({ OUTPOST: 1 });
    expect(materialOf(scene, 0).defines).toEqual({});
    expect(layer.rings.get(1)).toBeGreaterThan(0);
  });

  it("stands a sealed outpost on striped plates", () => {
    const { scene } = build({ planet: "moon" });
    const group = scene.children.find((o) => o instanceof THREE.Group);
    const mesh = group?.children[0] as THREE.Mesh;
    expect(Array.from(mesh.geometry.getAttribute("kind").array)).toContain(14);
  });

  it("fogs and rings a sealed outpost", () => {
    const { scene, layer, towns } = build({ planet: "red" });
    expect(() =>
      layer.setStyle(0, {
        hidden: true,
        ring: { color: new THREE.Color(1, 1, 1), strength: 0.9, thick: true },
      }),
    ).not.toThrow();
    expect(materialOf(scene, 0).uniforms.uHidden.value).toBe(1);
    for (const town of towns) {
      expect(layer.tops.get(town.node)).toBeDefined();
      expect(layer.rings.get(town.node)).toBeGreaterThan(0);
    }
  });

  it("builds each structure once in each colourway", () => {
    const spy = vi.mocked(buildOutpost);
    spy.mockClear();
    build({ planet: "moon" });
    const keys = spy.mock.calls.map(([m, , , paint]) => `${m.id}:${paint.id}`);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("dims a hidden town's street trees with it", () => {
    const { scene, layer } = build();
    layer.setStyle(0, { hidden: true });
    const dim = streetTreeMeshes(scene).map(
      (m) => (m.material as THREE.ShaderMaterial).uniforms.uDim.value,
    );
    expect(dim).toContain(1);
    expect(dim).toContain(0);
    layer.setStyle(0, { hidden: false });
    for (const m of streetTreeMeshes(scene))
      expect((m.material as THREE.ShaderMaterial).uniforms.uDim.value).toBe(0);
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

describe("groundUnder", () => {
  it("finds the lowest and highest ground under a turned rectangle", () => {
    // Ground rising one in ten along x.
    const slope = (x: number) => x / 10;
    const { lo, top } = groundUnder(slope, 5, 0, 2, 1, Math.PI / 2);
    // A quarter turn lays the rectangle's 2 along z, so x spans 4.5 to 5.5.
    expect(lo).toBeCloseTo(0.45, 9);
    expect(top).toBeCloseTo(0.55, 9);
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
