import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import { planetOf } from "../planets";
import type { GroundLayer } from "./groundLayer";
import type { RoadLine } from "./roadMask";
import { sceneSeed } from "./roadNetwork";
import type { TerrainSurface } from "./terrain";
import type { BiomePixels } from "./terrainMesh";
import { blockBakeMaterial, TOWN_STATE_ROWS, townMaterial } from "./townShader";
import {
  anyTexelNear,
  BLOCK_BAKE_TEXELS,
  blockBakeLayout,
  blockSlotTexels,
  buildableAt,
  buildTownIndex,
  clipRoads,
  dryFarmColour,
  dryFarmShare,
  farmableAt,
  fieldCell,
  planTowns,
  RIBBON_ROAD,
  roadEntries,
  TOWN_DATA_ROWS,
  type Town,
  townCell,
  townDataTexels,
  townPatches,
  withStreets,
} from "./towns";

/**
 * A town at every location of a generated terrain map, drawn on patches of
 * ground laid over the terrain (`townShader.ts`), and the state each one is
 * drawn in. Where the towns go and how big they are is pure (`towns.ts`).
 * This puts them on the GPU, once per map.
 */

/** How one town is drawn now. */
export interface TownStyle {
  /** Hidden by fog: drawn dim and grey. */
  hidden: boolean;
  /** The ring round the town's edge, or none. */
  ring?: {
    color: THREE.Color;
    /** 0 to 1. */
    strength: number;
    /** True for the thick ring of a selected town. */
    thick: boolean;
    /**
     * A landmark's ring only, which stands in for its badge: the faction
     * shape it is drawn as, 0 or left out for round.
     */
    sides?: number;
    /** A landmark's ring only: how many times a town's ring it is wide. */
    weight?: number;
  };
  /** Drawn in a dark violet haze, for a warpath's anomaly. */
  mist?: boolean;
}

export interface TownLayer {
  /** The towns by node index. */
  towns: Town[];
  /** Restyle the town of node `i`. Takes effect at {@link commit}. */
  setTownStyle: (i: number, style: TownStyle) => void;
  /** Send the town states to the GPU. */
  commit: () => void;
  /**
   * Call with the renderer before each draw. The first call draws the block
   * bake, which the town shader reads from then on.
   */
  prepare: (renderer: THREE.WebGLRenderer) => void;
}

/** How far along a road its direction into a town is read, in world units. */
const ENTRY_REACH = 1;
/** How far above the terrain the patches lie, in world units. */
const PATCH_LIFT = 0.005;
/**
 * Drawn after the province fills (`provinceLayer.ts`, -3), so a town keeps its
 * own colours inside an owner's tint, and before the borders (-2).
 */
const TOWN_ORDER = -2.5;
/** Fields are drawn before the province fills, so they take an owner's tint. */
const FIELD_ORDER = -4;
/** The steps the ground's slope is judged over, in world units. */
const SLOPE_STEP = 0.25;

const scratch = new THREE.Color();
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** A texture read texel by texel, never blended. */
function exact(texture: THREE.DataTexture): THREE.DataTexture {
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Build the towns {@link townsOnRoads} planned into `scene`. */
export function buildTownLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  ground: Pick<GroundLayer, "shading">,
  towns: Town[],
  /** The map's biome weights, which say where fields can go. Left out, none do. */
  biomes?: BiomePixels,
  /**
   * With no weights to read, put fields on any buildable ground, for a
   * hand-made map, which has no biome weights to say where fields go.
   */
  fieldsAnywhere = false,
  /**
   * Towns, by index, that a landmark stands in place of. They keep their
   * index, so a location's state still finds its town, but nothing of them
   * is painted.
   */
  omit: ReadonlySet<number> = new Set(),
): TownLayer {
  const columns = Math.max(1, towns.length);
  const state = new Uint8Array(columns * TOWN_STATE_ROWS * 4);

  // A heightmap pixel of 1 in 255 is the lowest land, so half that is sea.
  const sea = (0.5 / 255) * surface.heightScale * surface.scale;
  const buildable = buildableAt(
    (x, z) => surface.groundHeightAtWorld(x, z),
    sea,
    SLOPE_STEP,
  );
  // A map with no planet, which is a hand-made one, is settled as Temperate.
  const settlement = planetOf(biomes?.planet ?? "temperate").settlement;
  const flat = (x: number, z: number) =>
    Math.min(1, Math.max(0, (buildable(x, z) - 0.85) / 0.15));
  // What lies round a town goes on farm ground for fields, and on any flat
  // ground for a sealed outpost's works.
  const outskirts =
    settlement.outskirts === "none"
      ? undefined
      : settlement.outskirts === "works"
        ? flat
        : biomes
          ? farmableAt(
              biomes,
              surface.worldWidth,
              surface.worldDepth,
              buildable,
            )
          : fieldsAnywhere
            ? flat
            : undefined;
  const index = buildTownIndex(
    towns,
    surface.worldWidth,
    surface.worldDepth,
    undefined,
    buildable,
    outskirts,
  );
  // The town in each texel is read exactly, and the ground's fitness blended.
  const indexTexture = new THREE.DataTexture(
    index.data,
    index.width,
    index.height,
    THREE.RGBAFormat,
  );
  indexTexture.flipY = false;
  indexTexture.magFilter = THREE.LinearFilter;
  indexTexture.minFilter = THREE.LinearFilter;
  indexTexture.needsUpdate = true;
  const data = exact(
    new THREE.DataTexture(
      townDataTexels(towns),
      columns,
      TOWN_DATA_ROWS,
      THREE.RGBAFormat,
      THREE.FloatType,
    ),
  );
  const stateTexture = exact(
    new THREE.DataTexture(state, columns, TOWN_STATE_ROWS, THREE.RGBAFormat),
  );
  // Each pass draws only the cells it can show anything on. Every pixel of a
  // patch runs the shader's first reads before it can be thrown away, and
  // over discs of the fields' whole reach that cost each pass up to 0.6 ms a
  // frame (#3670).
  const grid = { ...index, stride: 4 };
  const roads = ground.shading.roadDistance.image as {
    data: Uint8Array;
    width: number;
    height: number;
  };
  const roadGrid = { ...roads, stride: 1 };
  const nearByte = (RIBBON_ROAD / ground.shading.roadReach) * 255;
  const roadNear = (x: number, z: number, r: number) =>
    anyTexelNear(
      roadGrid,
      surface.worldWidth,
      surface.worldDepth,
      x,
      z,
      r,
      (at) => roads.data[at] <= nearByte,
    );
  const townCells = towns.map((t, k) =>
    townCell(t, k, grid, surface.worldWidth, surface.worldDepth, roadNear),
  );
  const fieldCells = towns.map((t, k) =>
    fieldCell(t, k, grid, surface.worldWidth, surface.worldDepth),
  );
  const patchGeometry = (
    keep: (k: number, x: number, z: number, half: number) => boolean,
  ) => {
    const patches = townPatches(towns, surface, PATCH_LIFT, keep);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(patches.positions, 3),
    );
    geo.setAttribute("town", new THREE.BufferAttribute(patches.town, 1));
    geo.setIndex(new THREE.BufferAttribute(patches.index, 1));
    disposables.push(geo);
    return geo;
  };
  const geometry = {
    town: patchGeometry(
      (k, x, z, half) => !omit.has(k) && townCells[k](x, z, half),
    ),
    fields: patchGeometry(
      (k, x, z, half) => !omit.has(k) && fieldCells[k](x, z, half),
    ),
  };
  // Where the farm ground is dry, for the fields' look. None on a map with
  // no weights.
  const dry = new THREE.DataTexture(
    biomes ? dryFarmShare(biomes) : new Uint8Array(1),
    biomes?.width ?? 1,
    biomes?.height ?? 1,
    THREE.RedFormat,
  );
  dry.flipY = false;
  dry.magFilter = THREE.LinearFilter;
  dry.minFilter = THREE.LinearFilter;
  dry.needsUpdate = true;
  const dryRgb = (biomes && dryFarmColour(biomes.planet)) ?? [0, 0, 0];
  const clearing = planetOf(biomes?.planet ?? "temperate").clearing;
  const blocks = buildBlockBake(
    towns,
    settlement.style === "organic",
    disposables,
  );
  const shading = {
    blocks: blocks.shading,
    settlement,
    garden: new THREE.Color().setRGB(
      clearing[0] / 255,
      clearing[1] / 255,
      clearing[2] / 255,
      THREE.SRGBColorSpace,
    ),
    dry,
    dryGround: new THREE.Color().setRGB(
      dryRgb[0] / 255,
      dryRgb[1] / 255,
      dryRgb[2] / 255,
      THREE.SRGBColorSpace,
    ),
    index: indexTexture,
    indexSize: [index.width, index.height] as [number, number],
    data,
    state: stateTexture,
    roadDistance: ground.shading.roadDistance,
    roadReach: ground.shading.roadReach,
    frame: ground.shading.frame,
    river: ground.shading.river,
  };
  disposables.push(indexTexture, data, stateTexture, dry);
  // The fields first, under an owner's tint like the rest of the land, then
  // the town over the tint.
  for (const layer of ["fields", "town"] as const) {
    const mat = townMaterial(shading, layer);
    disposables.push(mat);
    const mesh = new THREE.Mesh(geometry[layer], mat);
    mesh.name = layer === "town" ? "towns" : "fields";
    mesh.renderOrder = layer === "town" ? TOWN_ORDER : FIELD_ORDER;
    mesh.raycast = () => {};
    if (towns.length > 0) scene.add(mesh);
  }

  return {
    towns,
    setTownStyle: (i, style) => {
      if (i < 0 || i >= towns.length) return;
      const top = i * 4;
      const ring = style.ring;
      if (ring) scratch.copy(ring.color).convertLinearToSRGB();
      state[top] = ring ? byte(scratch.r) : 0;
      state[top + 1] = ring ? byte(scratch.g) : 0;
      state[top + 2] = ring ? byte(scratch.b) : 0;
      state[top + 3] = ring ? byte(ring.strength) : 0;
      const low = (columns + i) * 4;
      state[low] = style.hidden ? 255 : 0;
      state[low + 1] = ring?.thick ? 255 : 0;
      state[low + 2] = style.mist ? 255 : 0;
    },
    commit: () => {
      stateTexture.needsUpdate = true;
    },
    prepare: blocks.draw,
  };
}

/**
 * The block pattern of every open town, drawn once on the GPU into one
 * picture (`blockBakeMaterial`), so the town shader looks each block up
 * rather than searching nine cells for it (#3666). A sealed outpost has no
 * blocks, so none is drawn.
 */
function buildBlockBake(
  towns: Town[],
  open: boolean,
  disposables: { dispose(): void }[],
) {
  const layout = open
    ? blockBakeLayout(towns)
    : { width: 1, height: 1, slots: towns.map(() => null) };
  const target = new THREE.WebGLRenderTarget(layout.width, layout.height, {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const slots = exact(
    new THREE.DataTexture(
      blockSlotTexels(layout.slots),
      Math.max(1, towns.length),
      2,
      THREE.RGBAFormat,
      THREE.FloatType,
    ),
  );
  const ready = { value: 0 };
  disposables.push(target, slots);
  // A quad a town, its corners at the texels its square covers.
  const placed = layout.slots.filter((s) => s !== null);
  let pending = placed.length > 0;
  const draw = (renderer: THREE.WebGLRenderer) => {
    if (!pending) return;
    pending = false;
    const position = new Float32Array(placed.length * 18);
    const slot = new Float32Array(placed.length * 24);
    placed.forEach((s, k) => {
      const side = s.cells * BLOCK_BAKE_TEXELS;
      const [x0, y0, x1, y1] = [s.x, s.y, s.x + side, s.y + side];
      position.set(
        [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0],
        k * 18,
      );
      for (let v = 0; v < 6; v++)
        slot.set([s.x, s.y, s.base[0], s.base[1]], k * 24 + v * 4);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("slot", new THREE.BufferAttribute(slot, 4));
    const mat = blockBakeMaterial(layout.width, layout.height);
    const mesh = new THREE.Mesh(geo, mat);
    // Placed in the picture by the vertex shader, not the camera.
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, new THREE.OrthographicCamera());
    renderer.setRenderTarget(previous);
    geo.dispose();
    mat.dispose();
    ready.value = 1;
  };
  return { shading: { bake: target.texture, slots, ready }, draw };
}

/**
 * A town at every node, sized by its roads and shaped by where they go, and
 * the roads cut where they reach a town, so a road stops at the town's edge
 * and its state is never drawn over the houses. Each town's main streets run
 * on from where its roads stop. Give the result's roads to the ground layer
 * in place of `roads`, and its towns to {@link buildTownLayer}.
 */
export function townsOnRoads(
  galaxy: GalaxyDoc,
  surface: Pick<TerrainSurface, "mapToWorldXZ">,
  roads: RoadLine[],
): { towns: Town[]; roads: RoadLine[] } {
  const toWorld = (x: number, y: number) => surface.mapToWorldXZ(x, y);
  // Every road and every crossing's track to its landing ends on an anchor.
  const entries = roadEntries(
    galaxy.nodes.map((n) => [n.pos[0], n.pos[1]]),
    roads.map((r) => r.line),
    toWorld,
    ENTRY_REACH,
  );
  const planned = planTowns(
    galaxy.nodes.map((n, i) => {
      const [x, z] = toWorld(n.pos[0], n.pos[1]);
      return { x, z, capital: n.kind === "capital", roads: entries[i] };
    }),
    sceneSeed(galaxy),
  );
  const { pieces, arrivals } = clipRoads(
    roads.map((r) => r.line),
    planned,
    toWorld,
  );
  return {
    towns: withStreets(planned, arrivals),
    roads: roads.flatMap((road, k) =>
      pieces[k].map((line) => ({ ...road, line })),
    ),
  };
}
