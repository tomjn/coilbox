/**
 * The landmarks that stand on a terrain map in place of a town: a stronghold
 * on every enemy capital, and an anomaly or a depot where a run asks for one.
 *
 * Each is built once, placed on the ground, turned to its road and kept clear
 * of its neighbours. It follows its location's fog, selection and haze the
 * way a town does, through {@link LandmarkLayer.setStyle}, and is never
 * picked: the location's own hit target carries the pointer.
 *
 * Towns could move onto this layer later. For now they keep their own.
 */
import * as THREE from "three";
import type { GalaxyDoc } from "../../model";
import type { PlanetId } from "../../planets";
import { hashString } from "../../rng";
import { TERRAIN_SUN, type TerrainSurface } from "../terrain";
import type { TerrainColorSource } from "../terrainMesh";
import type { TownStyle } from "../townLayer";
import { CAPITAL_NEIGHBOUR_SHARE, NEIGHBOUR_SHARE } from "../towns";
import { ANOMALY_REACH, ANOMALY_SHADOW_REACH, buildAnomaly } from "./anomalies";
import { buildDepot, DEPOT_REACH } from "./depot";
import { type AnomalyKind, landmarkKinds, type RunLandmark } from "./kinds";
import type { Rgb } from "./kit";
import { glowMaterial, landmarkMaterial, setLandmarkState } from "./material";
import {
  anomalyPalette,
  depotPalette,
  ruinPalette,
  strongholdPalette,
} from "./palettes";
import { buildRuin, RUIN_REACH } from "./ruin";
import { createLandmarkShadow, groundDecal } from "./shadow";
import { pickSite } from "./site";
import { buildStronghold, STRONGHOLD_REACH } from "./stronghold";

/** The ground's own colour at a world position, or undefined where unknown. */
export type TerrainColourReader = (
  worldX: number,
  worldZ: number,
) => Rgb | undefined;

/** Read the map picture's colour under a point, when it is held as raw pixels. */
export function terrainColourReader(
  color: Exclude<TerrainColorSource, string> | undefined,
  surface: TerrainSurface,
): TerrainColourReader | undefined {
  if (!color || !("data" in color)) return undefined;
  const { data, width, height } = color;
  return (worldX, worldZ) => {
    const [mx, my] = surface.worldToMap(worldX, worldZ);
    const px = Math.floor((mx / surface.width) * width);
    const py = Math.floor((my / surface.height) * height);
    if (px < 0 || py < 0 || px >= width || py >= height) return undefined;
    const at = (py * width + px) * 4;
    return [data[at], data[at + 1], data[at + 2]];
  };
}

export interface LandmarkLayer {
  /** The locations, by index into the galaxy's nodes, that got a landmark. */
  nodes: ReadonlySet<number>;
  /** Where each landmark stands, in map units, for the end markers to step aside. */
  anchors: { pos: [number, number] }[];
  /** Show a location's fog, ring and haze, as a town would. */
  setStyle(i: number, style: TownStyle): void;
  /** Call with the renderer before each draw. The first call draws the shadows. */
  prepare(renderer: THREE.WebGLRenderer): void;
}

interface Placed {
  materials: THREE.ShaderMaterial[];
  decal: ReturnType<typeof groundDecal>;
}

/** Build every landmark on a terrain map into `scene`. */
export function buildLandmarkLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  surface: TerrainSurface,
  galaxy: Pick<GalaxyDoc, "nodes" | "links">,
  playerFactionId: string,
  identities:
    | ReadonlyMap<
        string,
        { landmark?: RunLandmark; landmarkGroup?: boolean; end?: string }
      >
    | undefined,
  planet: PlanetId | undefined,
  colour: TerrainColourReader | undefined,
): LandmarkLayer {
  const world = galaxy.nodes.map((n) =>
    surface.mapToWorldXZ(n.pos[0], n.pos[1]),
  );
  const index = new Map(galaxy.nodes.map((n, i) => [n.id, i]));
  const sun = new THREE.Vector3(...TERRAIN_SUN);
  const placed = new Map<number, Placed>();
  const anchors: { pos: [number, number] }[] = [];
  const bakes: (() => void)[] = [];
  let renderer: THREE.WebGLRenderer | null = null;

  for (const [i, kind] of landmarkKinds(
    galaxy.nodes,
    playerFactionId,
    identities,
  )) {
    const stronghold = kind === "stronghold";
    const depot = kind === "depot";
    // A planet with no ruin, such as a moon, leaves the anomaly its town.
    const ruin = kind === "ruin" ? ruinPalette(planet) : undefined;
    if (kind === "ruin" && !ruin) continue;
    // A stronghold takes a capital's room, an anomaly an ordinary town's.
    const reach = stronghold
      ? STRONGHOLD_REACH
      : ruin
        ? RUIN_REACH
        : depot
          ? DEPOT_REACH
          : ANOMALY_REACH;
    const share = stronghold ? CAPITAL_NEIGHBOUR_SHARE : NEIGHBOUR_SHARE;
    const node = galaxy.nodes[i];
    const link = galaxy.links.find(([a, b]) => a === node.id || b === node.id);
    const other = link && index.get(link[0] === node.id ? link[1] : link[0]);
    const site = pickSite(
      surface,
      world[i],
      world.filter((_, k) => k !== i),
      other === undefined ? undefined : world[other],
      reach,
      share,
    );
    if (!site) continue;

    const cos = Math.cos(site.facing);
    const sin = Math.sin(site.facing);
    const edge = colour
      ? (lx: number, lz: number) =>
          colour(
            site.x + (lx * cos + lz * sin) * site.scale,
            site.z + (-lx * sin + lz * cos) * site.scale,
          )
      : undefined;
    const seed = hashString(node.id);
    // Node ids repeat from one map to the next, so where the node lies picks
    // the variation.
    const placedSeed = hashString(`${node.id}:${node.pos[0]}:${node.pos[1]}`);
    const { built } = stronghold
      ? buildStronghold(site.ground, strongholdPalette(planet), seed, edge)
      : ruin
        ? buildRuin(site.ground, ruin, seed, edge)
        : depot
          ? buildDepot(site.ground, depotPalette(planet), placedSeed)
          : buildAnomaly(
              kind as Exclude<AnomalyKind, "ruin">,
              site.ground,
              anomalyPalette(planet),
              placedSeed,
              edge,
              identities?.get(node.id)?.landmarkGroup,
            );

    const group = new THREE.Group();
    group.position.set(site.x, site.y, site.z);
    group.rotation.y = site.facing;
    group.scale.setScalar(site.scale);
    const materials: THREE.ShaderMaterial[] = [];
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.ShaderMaterial,
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.raycast = () => {};
      group.add(mesh);
      materials.push(material);
      disposables.push(geometry, material);
    };
    add(built.solid, landmarkMaterial());
    if (built.soft) add(built.soft, landmarkMaterial({ transparent: true }));
    if (built.glow) add(built.glow, glowMaterial());
    scene.add(group);
    group.updateMatrixWorld(true);

    // A standing anomaly is far taller than it is wide, and so is its shadow.
    // A depot's mast is as tall.
    const decal = groundDecal(
      surface,
      site,
      reach,
      null,
      stronghold || ruin ? reach : ANOMALY_SHADOW_REACH,
    );
    scene.add(decal.mesh);
    disposables.push(
      decal.mesh.geometry,
      decal.mesh.material as THREE.Material,
    );

    built.solid.computeBoundingBox();
    const bounds = (built.solid.boundingBox as THREE.Box3)
      .clone()
      .applyMatrix4(group.matrixWorld);
    const shadow = createLandmarkShadow(bounds, sun);
    disposables.push(
      shadow.target,
      shadow.target.depthTexture as THREE.Texture,
    );
    bakes.push(() => {
      if (!renderer || shadow.baked) return;
      // The crag lies on the ground, as the terrain does, so it casts nothing.
      shadow.bake(renderer, [
        { geometry: built.solid, matrix: group.matrixWorld },
      ]);
      for (const m of materials)
        if (m.uniforms.uShadow) {
          m.uniforms.uShadow.value = shadow.target.depthTexture;
          m.uniforms.uShadowMatrix.value.copy(shadow.matrix);
          m.uniforms.uShadowOn.value = 1;
        }
      decal.takeShadow(shadow);
    });

    placed.set(i, { materials, decal });
    anchors.push({ pos: surface.worldToMap(site.x, site.z) });
  }

  return {
    nodes: new Set(placed.keys()),
    anchors,
    setStyle(i, style) {
      const at = placed.get(i);
      if (!at) return;
      const state = { hidden: style.hidden };
      for (const m of at.materials) setLandmarkState(m, state);
      at.decal.setHidden(style.hidden);
      at.decal.setRing(style.ring);
    },
    prepare(r) {
      renderer = r;
      for (const bake of bakes) bake();
    },
  };
}
