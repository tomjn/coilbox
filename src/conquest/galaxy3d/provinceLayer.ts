import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import { NEUTRAL } from "../model";
import {
  BORDER_TOLERANCE_FRACTION,
  drapeFill,
  drapeLine,
  isStrongBorder,
  type ProvinceIndex,
  type ProvinceVisualState,
  provinceBorders,
  provinceIndexFor,
  provinceStyle,
  rayToMap,
  ribbonPositions,
} from "./provinces";
import type { TerrainSurface } from "./terrain";

/**
 * Provinces drawn on the terrain sheet: a translucent owner-coloured fill per
 * province, border lines with a stronger line where two owners meet, and a
 * capital marker. The maths is in `provinces.ts`.
 *
 * Geometry is built once. Everything that changes afterwards (owner, hover,
 * selection, and the states set through {@link ProvinceLayer.setState}) is a
 * material colour, an opacity, a visibility flag or the strong border's index
 * list, so nothing here rebuilds a fill.
 */

/** World units above the ground. Polygon offset does the rest. */
const FILL_LIFT = 0.05;
const BORDER_LIFT = 0.1;
const CAPITAL_LIFT = 0.15;

/** Line widths in world units. A point marker's disc is 2.7 across. */
const BORDER_WIDTH = 0.2;
const STRONG_BORDER_WIDTH = 0.55;

/** Outer radius of the capital star in world units. */
const CAPITAL_RADIUS = 1.3;

export interface ProvinceLayer {
  /** The provinces, searchable by map point. */
  index: ProvinceIndex;
  /** True when the node at this index is drawn as a province. */
  isProvince(nodeIndex: number): boolean;
  /**
   * Node index of the province under a ray, or -1 when the ray lands on
   * ground that belongs to no province, or misses the sheet. A hidden
   * province is still returned: the caller decides what may be selected.
   */
  pick(ray: THREE.Ray): number;
  /** Re-read every province's owner and restyle fills and borders. */
  applyOwners(): void;
  /** The hovered node index, or -1. Ignores nodes that are not provinces. */
  setHovered(nodeIndex: number): void;
  /** The selected node index, or -1. Ignores nodes that are not provinces. */
  setSelected(nodeIndex: number): void;
  /**
   * Merge a visual state into a province, by node id, and restyle it. Pass
   * `false` or `undefined` for a field to clear it. Unknown ids and point
   * locations are ignored.
   */
  setState(nodeId: string, state: ProvinceVisualState): void;
  /** The state last set for a node id. */
  getState(nodeId: string): ProvinceVisualState;
}

/** A five point star lying flat, pointing to map north (world -Z). */
function starGeometry(radius: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const rim: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? radius : radius * 0.42;
    const a = (k / 10) * Math.PI * 2;
    rim.push([Math.sin(a) * r, -Math.cos(a) * r]);
  }
  for (let k = 0; k < 10; k++) {
    const [x1, z1] = rim[k];
    const [x2, z2] = rim[(k + 1) % 10];
    positions.push(0, 0, 0, x1, 0, z1, x2, 0, z2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

/**
 * Build the province layer into `scene`. Returns `undefined`, and adds
 * nothing, when the map has no provinces: see {@link provinceIndexFor}.
 *
 * `labels` are the name labels by node index. The layer only hides and shows
 * them for the `hidden` state. Their colour stays with `owners.ts`.
 */
export function buildProvinceLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  ownerColor: (owner: string | undefined) => THREE.Color,
  ownersRef: { current: Record<string, string> },
  labels: (THREE.Object3D | undefined)[],
): ProvinceLayer | undefined {
  const index = provinceIndexFor(galaxy);
  if (!index) return undefined;

  const ownerOf = (i: number): string =>
    ownersRef.current[galaxy.nodes[i].id] ?? galaxy.nodes[i].owner;
  const states = new Map<number, ProvinceVisualState>();
  const stateOf = (i: number): ProvinceVisualState => states.get(i) ?? {};
  let hovered = -1;
  let selected = -1;

  // Drawn after the opaque sheet and before the lanes and markers, which are
  // transparent too. The offset pulls each layer toward the camera in depth,
  // so a fill lying on the ground does not flicker against it.
  const overlay = (order: number) => ({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -order,
    polygonOffsetUnits: -order * 2,
  });

  /* -------------------------------- fills -------------------------------- */

  const fillMats = new Map<number, THREE.MeshBasicMaterial>();
  const capitals = new Map<number, THREE.Mesh>();
  let capitalGeo: THREE.BufferGeometry | undefined;
  let capitalMat: THREE.MeshBasicMaterial | undefined;
  for (const i of index.nodes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        drapeFill(index.ringsOf(i), surface, FILL_LIFT),
        3,
      ),
    );
    const mat = new THREE.MeshBasicMaterial(overlay(1));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `province-fill:${galaxy.nodes[i].id}`;
    mesh.renderOrder = -3;
    mesh.raycast = () => {};
    disposables.push(geo, mat);
    scene.add(mesh);
    fillMats.set(i, mat);

    if (galaxy.nodes[i].kind !== "capital") continue;
    if (!capitalGeo || !capitalMat) {
      capitalGeo = starGeometry(CAPITAL_RADIUS);
      capitalMat = new THREE.MeshBasicMaterial({
        ...overlay(3),
        color: 0xffffff,
        opacity: 0.95,
      });
      disposables.push(capitalGeo, capitalMat);
    }
    // A flat star on a slope would dig in on its uphill side, so it sits at
    // the highest ground under it.
    const [mapX, mapY] = galaxy.nodes[i].pos;
    const reach = CAPITAL_RADIUS / surface.scale;
    let ground = surface.groundHeightAt(mapX, mapY);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ground = Math.max(
        ground,
        surface.groundHeightAt(
          mapX + Math.cos(a) * reach,
          mapY + Math.sin(a) * reach,
        ),
      );
    }
    const [x, z] = surface.mapToWorldXZ(mapX, mapY);
    const star = new THREE.Mesh(capitalGeo, capitalMat);
    star.name = `province-capital:${galaxy.nodes[i].id}`;
    star.position.set(x, ground + CAPITAL_LIFT, z);
    star.renderOrder = -1;
    star.raycast = () => {};
    scene.add(star);
    capitals.set(i, star);
  }

  /* ------------------------------- borders ------------------------------- */

  const pieces = provinceBorders(
    index,
    Math.max(surface.width, surface.height) * BORDER_TOLERANCE_FRACTION,
  );
  // Each piece draped over the relief, as world points.
  const draped = pieces.map((piece) =>
    drapeLine(piece.a, piece.b, surface).map(([x, y]) =>
      surface.mapToWorld(x, y, BORDER_LIFT),
    ),
  );
  const ribbonMesh = (
    width: number,
    which: number[],
    order: number,
    opacity: number,
  ) => {
    // Where each piece's vertices start, so its quads can be indexed alone.
    const starts: number[] = [];
    const chunks: Float32Array[] = [];
    let vertices = 0;
    for (const k of which) {
      const chunk = ribbonPositions(draped[k], width);
      starts.push(vertices);
      chunks.push(chunk);
      vertices += chunk.length / 3;
    }
    const positions = new Float32Array(vertices * 3);
    chunks.forEach((chunk, n) => {
      positions.set(chunk, starts[n] * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.MeshBasicMaterial({
      ...overlay(order),
      color: 0xffffff,
      opacity,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -2;
    mesh.raycast = () => {};
    disposables.push(geo, mat);
    scene.add(mesh);
    /** Draw only the listed entries of `which`. */
    const show = (entries: number[]) => {
      const indices: number[] = [];
      for (const n of entries) {
        const quads = chunks[n].length / 12;
        for (let q = 0; q < quads; q++) {
          const v = starts[n] + q * 4;
          indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
        }
      }
      geo.setIndex(indices);
    };
    return { mesh, show };
  };

  const all = pieces.map((_, k) => k);
  const plain = ribbonMesh(BORDER_WIDTH, all, 2, 0.4);
  plain.mesh.name = "province-borders";
  plain.show(all.map((_, n) => n));
  // Only a border with a province on each side can be a strong one.
  const shared = all.filter((k) => pieces[k].neighbour >= 0);
  const strong = ribbonMesh(STRONG_BORDER_WIDTH, shared, 2, 0.9);
  strong.mesh.name = "province-borders-strong";

  /* -------------------------------- style -------------------------------- */

  const WHITE = new THREE.Color(0xffffff);
  const styleOne = (i: number) => {
    const mat = fillMats.get(i);
    if (!mat) return;
    const owner = ownerOf(i);
    const state = stateOf(i);
    const style = provinceStyle({
      ...state,
      neutral: owner === NEUTRAL,
      hovered: i === hovered,
      selected: i === selected,
    });
    mat.color
      .copy(ownerColor(style.tint === "owner" ? owner : undefined))
      .lerp(WHITE, style.lighten);
    mat.opacity = style.opacity;
    const label = labels[i];
    if (label) label.visible = style.showMarkers;
    const star = capitals.get(i);
    if (star) star.visible = style.showMarkers;
  };

  const styleBorders = () => {
    const entries: number[] = [];
    shared.forEach((k, n) => {
      const { province, neighbour } = pieces[k];
      if (
        isStrongBorder(
          ownerOf(province),
          ownerOf(neighbour),
          !!stateOf(province).hidden,
          !!stateOf(neighbour).hidden,
        )
      ) {
        entries.push(n);
      }
    });
    strong.show(entries);
  };

  const applyOwners = () => {
    for (const i of index.nodes) styleOne(i);
    styleBorders();
  };

  const setHovered = (nodeIndex: number) => {
    const next = index.has(nodeIndex) ? nodeIndex : -1;
    if (next === hovered) return;
    const previous = hovered;
    hovered = next;
    styleOne(previous);
    styleOne(next);
  };
  const setSelected = (nodeIndex: number) => {
    const next = index.has(nodeIndex) ? nodeIndex : -1;
    if (next === selected) return;
    const previous = selected;
    selected = next;
    styleOne(previous);
    styleOne(next);
  };

  const nodeIndexById = new Map(galaxy.nodes.map((n, i) => [n.id, i]));
  const setState = (nodeId: string, state: ProvinceVisualState) => {
    const i = nodeIndexById.get(nodeId);
    if (i === undefined || !index.has(i)) return;
    const before = stateOf(i);
    const after = { ...before, ...state };
    states.set(i, after);
    styleOne(i);
    // Only fog changes which borders are strong.
    if (!!before.hidden !== !!after.hidden) styleBorders();
  };

  applyOwners();

  return {
    index,
    isProvince: (nodeIndex) => index.has(nodeIndex),
    pick: (ray) => {
      const hit = rayToMap(
        surface,
        [ray.origin.x, ray.origin.y, ray.origin.z],
        [ray.direction.x, ray.direction.y, ray.direction.z],
      );
      return hit ? index.at(hit[0], hit[1]) : -1;
    },
    applyOwners,
    setHovered,
    setSelected,
    setState,
    getState: (nodeId) => {
      const i = nodeIndexById.get(nodeId);
      return i === undefined ? {} : { ...stateOf(i) };
    },
  };
}
