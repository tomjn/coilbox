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
import { at, Builder, box, seeded } from "../landmarks/kit";
import { landmarkMaterial, setLandmarkState } from "../landmarks/material";
import { townPalette } from "../landmarks/palettes";
import { createLandmarkShadow, groundDecal } from "../landmarks/shadow";
import type { LandmarkSite } from "../landmarks/site";
import { TERRAIN_SUN, type TerrainSurface } from "../terrain";
import type { TownStyle } from "../townLayer";
import { buildableAt, CAPITAL_RADIUS, type Town, townEdge } from "../towns";
import { buildModel, modelsFor } from "./buildings";
import { footprint, gridFor, layoutTown, type TownGround } from "./layout";

export interface TownModelLayer {
  /** The towns that were built, by node index. */
  nodes: ReadonlySet<number>;
  /** The height of each town's tallest building, in world units, by node index. */
  tops: ReadonlyMap<number, number>;
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
/** Between the province fills (-2.5) and the decal (-2.4). */
const SHEET_ORDER = -2.45;
/** Where the decal draws its ring, as a share of its reach. Must match `RING_AT` in `landmarks/shadow.ts`. */
const RING_AT = 0.92;
/** The side of the largest shadow picture. */
const MAX_SHADOW = 1024;
/** A gap under a building smaller than this needs no foundation. */
const FOUNDATION_MIN = 0.001;
/** How much a building's shade may drift from the kit's own. */
const SHADE_DRIFT = 0.14;

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

interface Placed {
  material: THREE.ShaderMaterial;
  sheet: THREE.MeshBasicMaterial;
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
): TownModelLayer {
  const style = planetOf(planet ?? "temperate").settlement.style;
  const grid = gridFor(style);
  const palette = townPalette(planet);
  const models = modelsFor(style);
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

  const placed = new Map<number, Placed>();
  const tops = new Map<number, number>();
  const bakes: (() => void)[] = [];
  let shadowBytes = 0;
  let renderer: THREE.WebGLRenderer | null = null;

  for (const town of towns) {
    if (omit.has(town.node)) continue;
    const placements = layoutTown(town, grid, models, ground);
    if (placements.length === 0) continue;

    const y0 = height(town.x, town.z);
    const rand = seeded(Math.floor(town.seed * 1e9) + 1);
    const foundations = new Builder();
    let foundationCount = 0;
    const parts: THREE.BufferGeometry[] = [];
    for (const placement of placements) {
      const model = models[placement.model];
      const [w, d] = footprint(model, grid);
      // A rotation by `turn` about y sends the model's +x and +z here.
      const ex = [Math.cos(placement.turn), -Math.sin(placement.turn)];
      const ez = [Math.sin(placement.turn), Math.cos(placement.turn)];
      let lo = Number.POSITIVE_INFINITY;
      let top = Number.NEGATIVE_INFINITY;
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const gh = height(
          placement.x + (a * w * ex[0]) / 2 + (b * d * ez[0]) / 2,
          placement.z + (a * w * ex[1]) / 2 + (b * d * ez[1]) / 2,
        );
        lo = Math.min(lo, gh);
        top = Math.max(top, gh);
      }
      const x = placement.x - town.x;
      const z = placement.z - town.z;
      const copy = geometries[placement.model].clone();
      copy.applyMatrix4(at(x, top - y0, z, placement.turn));
      const shade = 1 + (rand() - 0.5) * SHADE_DRIFT;
      const colour = copy.getAttribute("color");
      for (let i = 0; i < colour.array.length; i++) colour.array[i] *= shade;
      parts.push(copy);
      // Fill the gap under a building on a slope, so no side shows daylight.
      if (top - lo > FOUNDATION_MIN) {
        foundations.add(
          box(w, top - lo, d, 0, 0.4),
          palette.building,
          at(x, lo - y0, z, placement.turn),
        );
        foundationCount++;
      }
    }
    if (foundationCount > 0) parts.push(foundations.build().solid);
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
    const material = landmarkMaterial();
    const mesh = new THREE.Mesh(merged, material);
    mesh.raycast = () => {};
    group.add(mesh);
    scene.add(group);
    group.updateMatrixWorld(true);
    disposables.push(merged, material);

    // The street surface: a plain sheet draped on the ground, fading at the edge.
    const sheetMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    const sheetGeometry = streetSheet(town, palette.street, height, buildable);
    const sheet = new THREE.Mesh(sheetGeometry, sheetMaterial);
    sheet.name = TOWN_NAME;
    sheet.renderOrder = SHEET_ORDER;
    sheet.raycast = () => {};
    scene.add(sheet);
    disposables.push(sheetGeometry, sheetMaterial);

    const site: LandmarkSite = {
      x: town.x,
      y: y0,
      z: town.z,
      scale: 1,
      facing: 0,
      ground: (lx, lz) => height(town.x + lx, town.z + lz) - y0,
    };
    // The ring lies one lot outside the furthest edge, clear of the buildings.
    const reach = (town.radius * EDGE_MAX + grid.lot) / RING_AT;
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

    placed.set(town.node, { material, sheet: sheetMaterial, decal });
    tops.set(town.node, bounds.max.y);
  }

  return {
    nodes: new Set(placed.keys()),
    tops,
    shadowBytes,
    setStyle(i, state) {
      const town = placed.get(i);
      if (!town) return;
      setLandmarkState(town.material, { hidden: state.hidden });
      // The sheet's colours are in its vertices, so the material dims them.
      town.sheet.color.setScalar(state.hidden ? 0.7 : 1);
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
      pos.push(x, height(x, z) + SHEET_LIFT, z);
      col.push(
        colour.r,
        colour.g,
        colour.b,
        SHEET_OPACITY * fade * (buildable(x, z) > 0 ? 1 : 0),
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
