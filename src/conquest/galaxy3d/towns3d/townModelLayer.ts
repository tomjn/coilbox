/**
 * The towns of a terrain map drawn as blocks of buildings. Each town is one
 * merged mesh of its buildings, a plain street sheet draped on the ground, a
 * shadow baked once from the sun and a ground decal that shows the shadow and
 * the town's ring. It is modelled on the landmark layer, and follows a town's
 * fog and ring through {@link TownModelLayer.setStyle} the same way.
 *
 * Every model is built once for the map, and each building is a copy of its
 * model moved to its lot, so a town costs one geometry however many buildings
 * it holds. Nothing here is picked: the location's own hit target carries the
 * pointer.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PlanetId } from "../../planets";
import { planetOf } from "../../planets";
import { instancedTrees, type TreeInstance } from "../forest3d/forestLayer";
import { treeMaterial } from "../forest3d/material";
import { SPECIES } from "../forest3d/placement";
import { treeGeometry } from "../forest3d/trees";
import { at, Builder, box, seeded } from "../landmarks/kit";
import { landmarkMaterial, setLandmarkState } from "../landmarks/material";
import { townPalette } from "../landmarks/palettes";
import { createLandmarkShadow, groundDecal } from "../landmarks/shadow";
import type { LandmarkSite } from "../landmarks/site";
import { TERRAIN_SUN, type TerrainSurface } from "../terrain";
import type { TownStyle } from "../townLayer";
import { buildableAt, CAPITAL_RADIUS, type Town, townEdge } from "../towns";
import { buildModel, modelsFor } from "./buildings";
import {
  BUILD_FIT,
  footprint,
  layoutOutpost,
  layoutTown,
  OPEN_GRID,
  OUTPOST_GRID,
  RIVER_BANK,
  type TownGround,
} from "./layout";
import { dress, liveryFor } from "./liveries";
import {
  type Colourway,
  colourwayFor,
  isSealedPlanet,
  outpostColourwaysOn,
  outpostPaint,
  type SealedPlanetId,
} from "./outpostColourways";
import { foundationPlate, PLATE_DECK } from "./outpostParts";
import { buildOutpost, OUTPOSTS } from "./outposts";
import { applyStreetGround } from "./streetGround";
import { streetTrees } from "./streetTrees";

export interface TownModelLayer {
  /** The towns that were built, by node index. */
  nodes: ReadonlySet<number>;
  /** The height of each town's tallest building, in world units, by node index. */
  tops: ReadonlyMap<number, number>;
  /** The radius each town's ring is drawn at, in world units, by node index. */
  rings: ReadonlyMap<number, number>;
  /** Show a town's fog and ring. Mist is not drawn. */
  setStyle(i: number, style: TownStyle): void;
  /** Call with the renderer before each draw. The first call draws the shadows. */
  prepare(renderer: THREE.WebGLRenderer): void;
  /** Bytes of shadow texture held, for the PR's report. */
  shadowBytes: number;
}

/** The name of a town's group, street sheet and decal, so a probe can find them. */
const TOWN_NAME = "town-models";
/** The steps the ground's slope is judged over, in world units. */
const SLOPE_STEP = 0.25;
/** The most a town's edge reaches past its radius, as `townEdge` in `towns.ts` has it. */
const EDGE_MAX = 1.27;
/** The street sheet's grid step, and how far above the ground it lies. */
const SHEET_STEP = 0.08;
const SHEET_LIFT = 0.008;
const SHEET_OPACITY = 0.9;
/** Where the sheet starts to fade and where it is gone, as shares of the town's edge. */
const SHEET_FADE_FROM = 0.9;
const SHEET_FADE_TO = 1.08;
/** Distance from a river's edge where the painted towns began to fade in. */
const RIVER_FADE_FROM = 0.015;
/** Between the province fills (-2.5) and the decal (-2.4). */
const SHEET_ORDER = -2.45;
/** Where the decal draws its ring, as a share of its reach. Must match `RING_AT` in `landmarks/shadow.ts`. */
const RING_AT = 0.92;
/** The side of the largest shadow picture. */
const MAX_SHADOW = 1024;
/** How much a building's shade may drift from the kit's own. */
const SHADE_DRIFT = 0.14;
/** How far the slab under a lot stands above the ground, clear of the street sheet. */
const PAVEMENT = 0.02;

/**
 * The shadow picture's side for a town, in proportion to its radius. A full
 * capital gets 1024, the texel density a stronghold's shadow already has.
 */
export function shadowSide(radius: number): number {
  return Math.min(
    MAX_SHADOW,
    Math.ceil((MAX_SHADOW * radius) / CAPITAL_RADIUS),
  );
}

/**
 * The lowest and highest ground under the corners of a rectangle `w` by `d`
 * centred on `x, z` and turned `turn`, as the layout turns a building.
 */
export function groundUnder(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  w: number,
  d: number,
  turn: number,
): { lo: number; top: number } {
  // A rotation by `turn` about y sends the model's +x and +z here.
  const ex = [Math.cos(turn), -Math.sin(turn)];
  const ez = [Math.sin(turn), Math.cos(turn)];
  let lo = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const gh = height(
      x + (a * w * ex[0]) / 2 + (b * d * ez[0]) / 2,
      z + (a * w * ex[1]) / 2 + (b * d * ez[1]) / 2,
    );
    lo = Math.min(lo, gh);
    top = Math.max(top, gh);
  }
  return { lo, top };
}

/** How far a plate's sides reach below the lowest ground under it, so no edge shows daylight. */
const PLATE_SINK = 0.02;
/** How far outside an outpost's furthest plate its ring is drawn. A first guess, tuned on screen. */
const OUTPOST_RING_CLEAR = 0.25;

/** A street tree's height, shortest and tallest, and how far it stands clear of a wall. */
const STREET_TREE: [number, number] = [0.08, 0.12];
const STREET_TREE_CLEAR = 0.035;

interface Placed {
  material: THREE.ShaderMaterial;
  trees: THREE.ShaderMaterial[];
  /** The street sheet, which a sealed outpost has none of. */
  sheet: THREE.MeshBasicMaterial | null;
  decal: ReturnType<typeof groundDecal>;
}

/** Build every town of a terrain map that no landmark stands on into `scene`. */
export function buildTownModelLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  towns: Town[],
  /** Towns, by node index, that a landmark stands in place of. */
  omit: ReadonlySet<number>,
  planet: PlanetId | undefined,
  riverEdge?: TownGround["riverEdge"],
  /**
   * Towns, by node index, built as a sealed outpost on a planet of open
   * towns. A sealed planet builds nothing else, so there it changes nothing.
   */
  outposts?: ReadonlySet<number>,
): TownModelLayer {
  const style = planetOf(planet ?? "temperate").settlement.style;
  /** The sealed planet a sealed outpost stands on, or null for an open town. */
  const sealed: SealedPlanetId | null =
    style === "sealed" && isSealedPlanet(planet) ? planet : null;
  const grid = OPEN_GRID;
  const palette = townPalette(planet);
  const models = sealed ? [] : modelsFor(style);
  const sun = new THREE.Vector3(...TERRAIN_SUN);
  // A heightmap pixel of 1 in 255 is the lowest land, so half that is sea.
  const sea = (0.5 / 255) * surface.heightScale * surface.scale;
  const height = (x: number, z: number) => surface.groundHeightAtWorld(x, z);
  const buildable = buildableAt(height, sea, SLOPE_STEP);
  const ground: TownGround = { buildable, riverEdge };

  const geometries = models.map((m) => {
    const [w, d] = footprint(m, grid);
    const g = buildModel(m, w, d, palette);
    disposables.push(g);
    return g;
  });

  // The kinds of tree an open town's streets are planted with: the planet's
  // own, and palms where it has scrub and no forest. A sealed outpost and a
  // planet where nothing grows have none.
  const world = planetOf(planet ?? "temperate");
  const treeKinds =
    style !== "organic"
      ? []
      : world.forest
        ? world.frost
          ? ["spruce"]
          : ["oak", "beech"]
        : world.biomes.some((b) => b.pattern === "scrub")
          ? ["palm"]
          : [];
  const treeShapes = treeKinds.map((id) => {
    const species = SPECIES.find((s) => s.id === id);
    if (!species) throw new Error(`No tree called ${id}.`);
    const shape = treeGeometry(species, false);
    disposables.push(shape);
    return { species, shape };
  });

  /** A town's buildings before they are merged, how far they reach and their footprints. */
  interface Body {
    parts: THREE.BufferGeometry[];
    /** How far the furthest corner of any building lies from the centre. */
    built: number;
    /** Each building's footprint, for keeping the street trees off the walls. */
    walls: { x: number; z: number; w: number; d: number; turn: number }[];
  }

  /** An open town's buildings, each on a slab of pavement, or null for none. */
  const buildOpenBody = (
    town: Town,
    y0: number,
    rand: () => number,
  ): Body | null => {
    const placements = layoutTown(town, grid, models, ground);
    if (placements.length === 0) return null;
    const foundations = new Builder();
    let built = 0;
    const parts: THREE.BufferGeometry[] = [];
    const walls: Body["walls"] = [];
    for (const placement of placements) {
      const model = models[placement.model];
      const [w, d] = footprint(model, grid);
      const { lo, top } = groundUnder(
        height,
        placement.x,
        placement.z,
        w,
        d,
        placement.turn,
      );
      const x = placement.x - town.x;
      const z = placement.z - town.z;
      walls.push({
        x: placement.x,
        z: placement.z,
        w,
        d,
        turn: placement.turn,
      });
      // An open town's lot is paved to its edge, past the building's own walls.
      const [sw, sd] = [model.lots[0] * grid.lot, model.lots[1] * grid.lot];
      built = Math.max(built, Math.hypot(x, z) + Math.hypot(sw, sd) / 2);
      const copy = geometries[placement.model].clone();
      copy.scale(1, placement.stretch, 1);
      copy.applyMatrix4(at(x, top - y0, z, placement.turn));
      const shade = 1 + (rand() - 0.5) * SHADE_DRIFT;
      const pick = rand();
      dress(
        copy,
        shade,
        model.filler ? undefined : liveryFor(pick, model.height),
      );
      parts.push(copy);
      // An open town's lot is a slab of pavement, so the streets between
      // read as streets. It reaches down to the lowest ground under it.
      foundations.add(
        box(sw, top - lo + PAVEMENT, sd, 0, 0.4),
        palette.pavement,
        at(x, lo - y0, z, placement.turn),
        { kind: 7, clean: true },
      );
    }
    parts.push(foundations.build().solid);
    return { parts, built, walls };
  };

  /** The planet whose dust, sand or snow settles on an outpost. */
  const settles = planet ?? "temperate";
  /** The planet whose colourways an outpost wears. */
  const colours = outpostColourwaysOn(planet);

  /** Each structure in each colourway, built once for the map. */
  const outpostGeometries = new Map<string, THREE.BufferGeometry>();
  const outpostGeometry = (
    k: number,
    colourway: Colourway,
  ): THREE.BufferGeometry => {
    const model = OUTPOSTS[k];
    const key = `${model.id}:${colourway.id}`;
    let g = outpostGeometries.get(key);
    if (!g) {
      const [w, d] = footprint(model, OUTPOST_GRID);
      g = buildOutpost(model, w, d, outpostPaint(settles, colourway));
      outpostGeometries.set(key, g);
      disposables.push(g);
    }
    return g;
  };

  /** A sealed outpost's structures on their plates, or null for none. */
  const buildOutpostBody = (
    town: Town,
    y0: number,
    rand: () => number,
  ): Body | null => {
    const { placements, plates } = layoutOutpost(
      town,
      OUTPOST_GRID,
      OUTPOSTS,
      ground,
    );
    if (placements.length === 0) return null;
    // An outpost's plates are all of one make.
    const plating = outpostPaint(
      settles,
      colourwayFor(colours, "deck", rand()),
    );
    const foundations = new Builder();
    let built = 0;
    // The height of each plate's deck above the town's level.
    const decks = plates.map((plate) => {
      const { lo, top } = groundUnder(
        height,
        plate.x,
        plate.z,
        plate.w,
        plate.d,
        plate.turn,
      );
      const x = plate.x - town.x;
      const z = plate.z - town.z;
      foundationPlate(
        foundations,
        plate.w,
        plate.d,
        top - lo + PLATE_SINK,
        plating,
        at(x, top - y0, z, plate.turn),
      );
      built = Math.max(
        built,
        Math.hypot(x, z) + Math.hypot(plate.w, plate.d) / 2,
      );
      return top - y0 + PLATE_DECK;
    });
    const parts: THREE.BufferGeometry[] = [];
    placements.forEach((placement, i) => {
      const model = OUTPOSTS[placement.model];
      const colourway = colourwayFor(colours, model.family, rand());
      const copy = outpostGeometry(placement.model, colourway).clone();
      // Each structure stands on its own plate, which the layout lists first.
      copy.applyMatrix4(
        at(
          placement.x - town.x,
          decks[i],
          placement.z - town.z,
          placement.turn,
        ),
      );
      dress(copy, 1 + (rand() - 0.5) * SHADE_DRIFT);
      parts.push(copy);
    });
    parts.push(foundations.build().solid);
    return { parts, built, walls: [] };
  };

  const placed = new Map<number, Placed>();
  const tops = new Map<number, number>();
  const rings = new Map<number, number>();
  const bakes: (() => void)[] = [];
  let shadowBytes = 0;
  let renderer: THREE.WebGLRenderer | null = null;

  for (const town of towns) {
    if (omit.has(town.node)) continue;
    const y0 = height(town.x, town.z);
    const rand = seeded(Math.floor(town.seed * 1e9) + 1);
    const outpost = sealed !== null || !!outposts?.has(town.node);
    const body = outpost
      ? buildOutpostBody(town, y0, rand)
      : buildOpenBody(town, y0, rand);
    if (!body) continue;
    const { parts, built, walls } = body;
    const merged = mergeGeometries(parts);
    if (!merged)
      throw new Error(
        `Town at node ${town.node} cannot merge its buildings: the building models' attributes differ.`,
      );
    for (const part of parts) part.dispose();
    merged.computeBoundingBox();
    const local = merged.boundingBox as THREE.Box3;

    const group = new THREE.Group();
    group.name = TOWN_NAME;
    group.position.set(town.x, y0, town.z);
    const material = landmarkMaterial({ outpost });
    const mesh = new THREE.Mesh(merged, material);
    mesh.raycast = () => {};
    group.add(mesh);
    scene.add(group);
    group.updateMatrixWorld(true);
    disposables.push(merged, material);

    // Street trees, down the main streets and the avenues.
    const treeMaterials: THREE.ShaderMaterial[] = [];
    if (treeShapes.length > 0 && !outpost) {
      const clearOf = (px: number, pz: number) =>
        buildable(px, pz) >= BUILD_FIT &&
        (!riverEdge || riverEdge(px, pz) >= RIVER_BANK) &&
        !walls.some((b) => {
          // The point in the building's own frame.
          const dx = px - b.x;
          const dz = pz - b.z;
          const lx = dx * Math.cos(b.turn) - dz * Math.sin(b.turn);
          const lz = dx * Math.sin(b.turn) + dz * Math.cos(b.turn);
          return (
            Math.abs(lx) < b.w / 2 + STREET_TREE_CLEAR &&
            Math.abs(lz) < b.d / 2 + STREET_TREE_CLEAR
          );
        });
      const lists: TreeInstance[][] = treeShapes.map(() => []);
      for (const spot of streetTrees(town, grid, clearOf)) {
        const k = Math.floor(rand() * treeShapes.length);
        const h = STREET_TREE[0] + (STREET_TREE[1] - STREET_TREE[0]) * rand();
        lists[k].push({
          x: spot.x,
          y: height(spot.x, spot.z),
          z: spot.z,
          height: h,
          width: h * treeShapes[k].species.spread,
          turn: rand() * Math.PI * 2,
          pick: rand(),
        });
      }
      lists.forEach((list, k) => {
        if (list.length === 0) return;
        const m = treeMaterial(
          world,
          { conifer: treeShapes[k].species.conifer },
          undefined,
        );
        const mesh = instancedTrees(treeShapes[k].shape, m, list);
        mesh.name = TOWN_NAME;
        scene.add(mesh);
        disposables.push(mesh.geometry, m);
        treeMaterials.push(m);
      });
    }
    // An open town's street surface: a sheet draped on the ground, fading at
    // its edge. A sealed outpost stands on bare ground.
    let sheetMaterial: THREE.MeshBasicMaterial | null = null;
    if (!outpost) {
      sheetMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });
      applyStreetGround(
        sheetMaterial,
        town,
        grid,
        palette,
        treeShapes.length > 0,
      );
      const sheetGeometry = streetSheet(
        town,
        palette.street,
        height,
        buildable,
        riverEdge,
      );
      const sheet = new THREE.Mesh(sheetGeometry, sheetMaterial);
      sheet.name = TOWN_NAME;
      sheet.renderOrder = SHEET_ORDER;
      sheet.raycast = () => {};
      scene.add(sheet);
      disposables.push(sheetGeometry, sheetMaterial);
    }

    const site: LandmarkSite = {
      x: town.x,
      y: y0,
      z: town.z,
      scale: 1,
      facing: 0,
      ground: (lx, lz) => height(town.x + lx, town.z + lz) - y0,
    };
    // The ring lies one lot outside the furthest building, or a little way
    // outside an outpost's furthest plate. A town's edge can reach well past
    // that, where the ground is too steep or wet to build on.
    const reach = (built + (outpost ? OUTPOST_RING_CLEAR : grid.lot)) / RING_AT;
    // The longest shadow the tallest building throws on level ground.
    const shadowReach =
      reach + (local.max.y * Math.hypot(sun.x, sun.z)) / sun.y;
    const decal = groundDecal(surface, site, reach, null, shadowReach, {
      contact: false,
    });
    decal.mesh.name = TOWN_NAME;
    scene.add(decal.mesh);
    disposables.push(
      decal.mesh.geometry,
      decal.mesh.material as THREE.Material,
    );

    const bounds = local.clone().applyMatrix4(group.matrixWorld);
    const side = shadowSide(town.radius);
    const shadow = createLandmarkShadow(bounds, sun, side);
    // Four bytes a texel for the colour target and four for the depth.
    shadowBytes += 8 * side * side;
    disposables.push(
      shadow.target,
      shadow.target.depthTexture as THREE.Texture,
    );
    bakes.push(() => {
      if (!renderer || shadow.baked) return;
      shadow.bake(renderer, [{ geometry: merged, matrix: group.matrixWorld }]);
      material.uniforms.uShadow.value = shadow.target.depthTexture;
      material.uniforms.uShadowMatrix.value.copy(shadow.matrix);
      material.uniforms.uShadowOn.value = 1;
      decal.takeShadow(shadow);
    });

    placed.set(town.node, {
      material,
      trees: treeMaterials,
      sheet: sheetMaterial,
      decal,
    });
    tops.set(town.node, bounds.max.y);
    rings.set(town.node, reach * RING_AT);
  }

  return {
    nodes: new Set(placed.keys()),
    tops,
    rings,
    shadowBytes,
    setStyle(i, state) {
      const town = placed.get(i);
      if (!town) return;
      setLandmarkState(town.material, { hidden: state.hidden });
      // The sheet's colours are in its vertices, so the material dims them.
      town.sheet?.color.setScalar(state.hidden ? 0.7 : 1);
      for (const m of town.trees) m.uniforms.uDim.value = state.hidden ? 1 : 0;
      town.decal.setHidden(state.hidden);
      town.decal.setRing(state.ring);
    },
    prepare(r) {
      renderer = r;
      for (const bake of bakes) bake();
    },
  };
}

/**
 * A grid over the town's bounding square, draped on the ground. Its colour
 * fades to nothing at the town's edge, and it is absent over sea.
 */
function streetSheet(
  town: Town,
  street: [number, number, number],
  height: (x: number, z: number) => number,
  buildable: (x: number, z: number) => number,
  riverEdge?: TownGround["riverEdge"],
): THREE.BufferGeometry {
  const n = Math.ceil(
    (town.radius * EDGE_MAX * SHEET_FADE_TO * 2) / SHEET_STEP,
  );
  const colour = new THREE.Color().setRGB(
    street[0] / 255,
    street[1] / 255,
    street[2] / 255,
    THREE.SRGBColorSpace,
  );
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const dx = (i / n - 0.5) * n * SHEET_STEP;
      const dz = (j / n - 0.5) * n * SHEET_STEP;
      const x = town.x + dx;
      const z = town.z + dz;
      const t = Math.hypot(dx, dz) / townEdge(town, Math.atan2(dz, dx));
      const fade =
        1 -
        Math.min(
          1,
          Math.max(
            0,
            (t - SHEET_FADE_FROM) / (SHEET_FADE_TO - SHEET_FADE_FROM),
          ),
        );
      // Absent in the water and on the first of the bank, so a river shows.
      const bank = riverEdge
        ? smoothstep(RIVER_FADE_FROM, RIVER_BANK, riverEdge(x, z))
        : 1;
      pos.push(x, height(x, z) + SHEET_LIFT, z);
      col.push(
        colour.r,
        colour.g,
        colour.b,
        SHEET_OPACITY * fade * bank * (buildable(x, z) > 0 ? 1 : 0),
      );
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  geometry.setIndex(idx);
  return geometry;
}

/** 0 below `a`, 1 above `b`, and smooth between. */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
