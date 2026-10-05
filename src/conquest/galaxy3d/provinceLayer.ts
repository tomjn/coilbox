import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import { NEUTRAL } from "../model";
import type { MapItemState } from "./cityLayer";
import {
  BORDER_TOLERANCE_FRACTION,
  type BorderPiece,
  drapeFill,
  drapeLine,
  isStrongBorder,
  type ProvinceIndex,
  pickProvince,
  provinceBorders,
  provinceIndexFor,
  provinceStyle,
  ribbonPositions,
} from "./provinces";
import type { TerrainSurface } from "./terrain";

/**
 * Provinces drawn on the terrain sheet: a translucent owner-coloured fill per
 * province, border lines with a stronger line where two owners meet, and a
 * capital marker. The maths is in `provinces.ts`.
 *
 * Geometry is built once. Everything that changes afterwards (owner, hover,
 * selection, and the states set through
 * {@link ProvinceLayer.setProvinceState}) is a material colour, an opacity, a visibility flag or the strong border's index
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
  /**
   * Every border piece the layer draws, each knowing the province on either
   * side. `cueLayer.ts` reads the shared edge of two provinces from this, so
   * a line it draws along a border lies on the one drawn here.
   */
  borders: readonly BorderPiece[];
  /** Whether this layer draws the node, which is to say it has an outline. */
  has: (nodeId: string) => boolean;
  /** The same, by node index. */
  isProvince: (nodeIndex: number) => boolean;
  /**
   * Node index of the province under a ray, or -1 when the ray lands on
   * ground that belongs to no province, or misses the sheet. A province
   * in the `hidden` state is never picked.
   */
  pick: (ray: THREE.Ray) => number;
  /** Restyle every fill and border for the current owners and states. */
  apply: () => void;
  /** Mark one province selected, or none. Point locations count as none. */
  select: (nodeId: string | null) => void;
  /** Mark one province hovered, or none. Point locations count as none. */
  hover: (nodeId: string | null) => void;
  /**
   * Set or clear a province's state, the same shape `cityLayer.ts` takes for
   * a location. Geometry is not rebuilt. Call {@link apply} once after a
   * batch of changes.
   */
  setProvinceState: (nodeId: string, state: MapItemState | undefined) => void;
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
 * `labels` are the name labels by node index. The layer puts a province's
 * label on its anchor and hides it for the `hidden` state. Its colour stays
 * with `owners.ts`.
 */
export function buildProvinceLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  ownerColor: (owner: string | undefined) => THREE.Color,
  ownersRef: { current: Record<string, string> },
  labels: (THREE.Object3D | undefined)[],
  /**
   * A node's graded emphasis, 0 to 1, as the city layer takes it. A run
   * pushes its scenery back with this. Left out, every province is at 1.
   */
  dimOf: (nodeId: string) => number = () => 1,
): ProvinceLayer | undefined {
  const index = provinceIndexFor(galaxy);
  if (!index) return undefined;

  const ownerOf = (i: number): string =>
    ownersRef.current[galaxy.nodes[i].id] ?? galaxy.nodes[i].owner;
  const states = new Map<number, MapItemState>();
  const stateOf = (i: number): MapItemState => states.get(i) ?? {};
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
    // A province's name sits on its anchor, on the ground.
    const [anchorX, anchorY] = galaxy.nodes[i].pos;
    labels[i]?.position.set(...surface.mapToWorld(anchorX, anchorY));

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
  // The gold of the galaxy's contested lanes and the amber of its incursion
  // warning, so the same colours mean the same things on every map.
  const ATTACK_COLOR = new THREE.Color(0xffcf8a);
  const THREAT_COLOR = new THREE.Color(0xffb020);
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
    mat.color.copy(ownerColor(style.tint === "owner" ? owner : undefined));
    if (style.accent) {
      mat.color.lerp(
        style.accent === "threat" ? THREAT_COLOR : ATTACK_COLOR,
        style.accentMix,
      );
    }
    mat.color.lerp(WHITE, style.lighten);
    mat.opacity = style.opacity * dimOf(galaxy.nodes[i].id);
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

  const apply = () => {
    for (const i of index.nodes) styleOne(i);
    styleBorders();
  };

  const nodeIndexById = new Map(galaxy.nodes.map((n, i) => [n.id, i]));
  /** A node id as a province's node index, or -1. */
  const provinceOf = (nodeId: string | null): number => {
    const i = nodeId === null ? undefined : nodeIndexById.get(nodeId);
    return i !== undefined && index.has(i) ? i : -1;
  };
  const hover = (nodeId: string | null) => {
    const next = provinceOf(nodeId);
    if (next === hovered) return;
    const previous = hovered;
    hovered = next;
    styleOne(previous);
    styleOne(next);
  };
  const select = (nodeId: string | null) => {
    const next = provinceOf(nodeId);
    if (next === selected) return;
    const previous = selected;
    selected = next;
    styleOne(previous);
    styleOne(next);
  };

  apply();

  return {
    index,
    borders: pieces,
    has: (nodeId) => provinceOf(nodeId) >= 0,
    isProvince: (nodeIndex) => index.has(nodeIndex),
    pick: (ray) =>
      pickProvince(
        index,
        surface,
        [ray.origin.x, ray.origin.y, ray.origin.z],
        [ray.direction.x, ray.direction.y, ray.direction.z],
        (i) => !!stateOf(i).hidden,
      ),
    apply,
    select,
    hover,
    setProvinceState: (nodeId, state) => {
      const i = provinceOf(nodeId);
      if (i < 0) return;
      if (state) states.set(i, state);
      else states.delete(i);
    },
  };
}
