import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { GalaxyDoc } from "../model";
import { NEUTRAL } from "../model";
import { factionSides } from "./factionShape";
import {
  type MapPoint,
  pairKey,
  roadLinks,
  roadRibbon,
  sampleRoadPath,
} from "./roads";
import {
  GALAXY_MAX_DISTANCE,
  MARKER_LIFT,
  type TerrainSurface,
} from "./terrain";

/**
 * Point locations and roads on a terrain map. A point location is a node with
 * no outline: a city, a base, a landing site. Each one draws as a block
 * standing on the ground at its anchor, in its owner's colour and its owner's
 * faction shape, and a capital carries a second, white-topped tier. The links
 * `roadLinks` picks out draw as roads that follow the ground.
 *
 * Nothing here is built for a galaxy or theatre map, and a node with an
 * outline is left to the province drawing.
 *
 * Picking stays with the view's own hit targets (`cores`), so hover and
 * selection report through the same `onSelect` as every other map. This layer
 * only draws the result, through {@link CityLayer.hover} and
 * {@link CityLayer.select}.
 */

/** The block's radius in world units, the theatre disc's own. */
const MARKER_RADIUS = 1.35;
/** How far the block stands above the ground at its anchor. */
const MARKER_HEIGHT = 1.2;
/** How far the block reaches below its anchor, so a slope never shows under it. */
const MARKER_FOOT = 1.5;
/** A capital's block is this much bigger, as the theatre disc is. */
const CAPITAL_SCALE = 1.25;
/** The capital's upper tier, as a share of the block's radius, and its height. */
const TIER_RADIUS = 0.55;
const TIER_HEIGHT = 0.9;
/** Sides of a round block. */
const ROUND_SEGMENTS = 32;
/** How dark the block's wall is against its top, so the shape reads in 3D. */
const WALL_SHADE = 0.55;
/** Growth of a selected block and of a hovered or emphasised one. These are
 * the factors the galaxy's ownership ring takes. */
const SELECTED_SCALE = 1.3;
const HOVER_SCALE = 1.15;
/** Gap between a block and its name, in world units. */
const LABEL_GAP = 0.5;

const WHITE = new THREE.Color(0xffffff);
/** A location or road hidden by fog: no owner shows through. */
const HIDDEN_COLOR = new THREE.Color(0x565c68);
/** A road whose ends do not share an owner. */
const ROAD_NEUTRAL_COLOR = new THREE.Color(0xe2dccb);
/** The warm gold the galaxy's contested lanes use. */
const ATTACKABLE_COLOR = new THREE.Color(0xffcf8a);
/** The amber of the incursion warning marker. */
const THREATENED_COLOR = new THREE.Color(0xffb020);
/** The green of the galaxy's path already travelled. */
const TRAVELLED_COLOR = new THREE.Color(0x46e08a);
const ROAD_OPACITY = 0.6;
const ROAD_OWNED_OPACITY = 0.9;

/**
 * A visual state for one location or one road, set by the attack cues (#3502)
 * and the fog of war (#3503). Every field left out is off.
 */
export interface MapItemState {
  /** The player can attack this location, or attack along this road. */
  attackable?: boolean;
  /** Picked out from the rest, as a neighbour of the selected location is. */
  emphasised?: boolean;
  /** An incursion is under way at this location. Not read for a road. */
  threatened?: boolean;
  /** A road the player has already travelled on a run. Not read for a location. */
  travelled?: boolean;
  /**
   * Hidden by fog. A hidden location draws as a plain grey round block with
   * no name and no capital tier. A hidden road is not drawn. A road with one
   * hidden end loses its owner colour, and one with both ends hidden is not
   * drawn either.
   */
  hidden?: boolean;
}

export interface CityLayer {
  /** Whether this layer draws the node, which is to say it has no outline. */
  has: (nodeId: string) => boolean;
  /** Restyle every marker and road for the current owners and states. */
  apply: () => void;
  /** Mark one location selected, or none. */
  select: (nodeId: string | null) => void;
  /** Mark one location hovered, or none. */
  hover: (nodeId: string | null) => void;
  /** Advance the selected marker's pulse. Call once per animation frame. */
  tick: (now: number) => void;
  /**
   * Keep markers a readable size: past the galaxy view's furthest zoom they
   * grow with the camera's distance, so they never draw smaller than a marker
   * does there. `distance` is from the camera to the point it looks at.
   */
  fitToCamera: (distance: number) => void;
  /**
   * Set or clear a location's state. Geometry is not rebuilt. Call
   * {@link apply} once after a batch of changes.
   */
  setLocationState: (nodeId: string, state: MapItemState | undefined) => void;
  /** The same for the road between two locations, either way round. */
  setRoadState: (a: string, b: string, state: MapItemState | undefined) => void;
}

interface Marker {
  /** Index into `galaxy.nodes`. */
  i: number;
  id: string;
  capital: boolean;
  group: THREE.Group;
  body: THREE.Mesh;
  tier?: THREE.Mesh;
  top: THREE.MeshBasicMaterial;
  wall: THREE.MeshBasicMaterial;
  /** The anchor on the ground, in world units. */
  x: number;
  ground: number;
  z: number;
}

export function buildCityLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: GalaxyDoc,
  surface: TerrainSurface,
  ownerColor: (owner: string | undefined) => THREE.Color,
  ownersRef: { current: Record<string, string> },
  laneDim: (a: string, b: string) => number,
  dimOf: (id: string) => number,
  /** The view's name labels, index-aligned to `galaxy.nodes`. May be empty. */
  labelObjects: CSS2DObject[],
  /** The view's hit targets, one instance per node. */
  cores: THREE.InstancedMesh,
): CityLayer {
  const nodeById = new Map(galaxy.nodes.map((n) => [n.id, n]));
  const ownerOf = (id: string): string =>
    ownersRef.current[id] ?? nodeById.get(id)?.owner ?? NEUTRAL;
  const locationStates = new Map<string, MapItemState>();
  const roadStates = new Map<string, MapItemState>();
  const isHidden = (id: string) => !!locationStates.get(id)?.hidden;

  /* ------------------------------- markers ------------------------------- */

  // One block geometry per faction shape, shared and swapped on capture. The
  // first corner points north, as the galaxy's ownership ring does.
  const bodyGeos = new Map<number, THREE.CylinderGeometry>();
  const tierGeos = new Map<number, THREE.CylinderGeometry>();
  const prism = (
    cache: Map<number, THREE.CylinderGeometry>,
    sides: number,
    radius: number,
    bottom: number,
    top: number,
  ) => {
    let geo = cache.get(sides);
    if (!geo) {
      geo = new THREE.CylinderGeometry(
        radius,
        radius,
        top - bottom,
        sides || ROUND_SEGMENTS,
        1,
        false,
        Math.PI,
      );
      geo.translate(0, (top + bottom) / 2, 0);
      cache.set(sides, geo);
      disposables.push(geo);
    }
    return geo;
  };
  const bodyGeoFor = (sides: number) =>
    prism(bodyGeos, sides, MARKER_RADIUS, -MARKER_FOOT, MARKER_HEIGHT);
  const tierGeoFor = (sides: number) =>
    prism(
      tierGeos,
      sides,
      MARKER_RADIUS * TIER_RADIUS,
      MARKER_HEIGHT,
      MARKER_HEIGHT + TIER_HEIGHT,
    );
  const tierTop = new THREE.MeshBasicMaterial({ color: 0xf4f1e6 });
  disposables.push(tierTop);

  const markers: Marker[] = [];
  const markerById = new Map<string, Marker>();
  galaxy.nodes.forEach((n, i) => {
    if (n.outline) return;
    const [x, ground, z] = surface.mapToWorld(n.pos[0], n.pos[1]);
    const top = new THREE.MeshBasicMaterial();
    const wall = new THREE.MeshBasicMaterial();
    disposables.push(top, wall);
    const group = new THREE.Group();
    group.position.set(x, ground, z);
    // A cylinder's material groups are its wall, its top and its underside.
    const body = new THREE.Mesh(bodyGeoFor(0), [wall, top, wall]);
    body.raycast = () => {};
    group.add(body);
    const capital = n.kind === "capital";
    let tier: THREE.Mesh | undefined;
    if (capital) {
      tier = new THREE.Mesh(tierGeoFor(0), [wall, tierTop, wall]);
      tier.raycast = () => {};
      group.add(tier);
    }
    scene.add(group);
    const marker = {
      i,
      id: n.id,
      capital,
      group,
      body,
      tier,
      top,
      wall,
      x,
      ground,
      z,
    };
    markers.push(marker);
    markerById.set(n.id, marker);
  });

  let zoom = 1;
  let selectedId: string | null = null;
  let hoveredId: string | null = null;

  const baseScale = (m: Marker) => zoom * (m.capital ? CAPITAL_SCALE : 1);
  const colorOf = (m: Marker): THREE.Color =>
    isHidden(m.id) ? HIDDEN_COLOR : ownerColor(ownerOf(m.id));

  /** Size a marker and put its name just south of it, clear of the block. */
  const place = (m: Marker, stateScale: number) => {
    const scale = baseScale(m) * stateScale;
    m.group.scale.setScalar(scale);
    const label = labelObjects[m.i];
    if (label) {
      label.position.set(
        m.x,
        m.ground,
        m.z + MARKER_RADIUS * scale + LABEL_GAP * zoom,
      );
      // Hang the name below that point instead of centring it on it.
      label.center.set(0.5, 0);
    }
  };

  const style = (m: Marker) => {
    const state = locationStates.get(m.id);
    const hidden = !!state?.hidden;
    const owner = ownerOf(m.id);
    const sides = hidden || owner === NEUTRAL ? 0 : factionSides(galaxy, owner);
    m.body.geometry = bodyGeoFor(sides);
    if (m.tier) {
      m.tier.geometry = tierGeoFor(sides);
      m.tier.visible = !hidden;
    }
    const selected = m.id === selectedId;
    const hovered = m.id === hoveredId;
    const dim = dimOf(m.id);
    const color = colorOf(m);
    m.top.color
      .copy(color)
      .lerp(WHITE, selected ? 0.3 : hovered ? 0.35 : 0)
      .multiplyScalar(dim);
    if (state?.threatened && !hidden) {
      m.wall.color.copy(THREATENED_COLOR).multiplyScalar(dim);
    } else if (state?.attackable && !hidden) {
      m.wall.color.copy(ATTACKABLE_COLOR).multiplyScalar(dim);
    } else {
      m.wall.color.copy(color).multiplyScalar(WALL_SHADE * dim);
    }
    const label = labelObjects[m.i];
    if (label) label.visible = !hidden;
    place(
      m,
      selected
        ? SELECTED_SCALE
        : hovered || state?.emphasised
          ? HOVER_SCALE
          : 1,
    );
  };

  /* -------------------------------- roads -------------------------------- */

  const roads = roadLinks(galaxy);
  // `roadLinks` only returns links whose two nodes exist.
  const anchorOf = (id: string): MapPoint => {
    const pos = nodeById.get(id)?.pos ?? [0, 0];
    return [pos[0], pos[1]];
  };
  const ribbon = roadRibbon(
    surface,
    roads.map((r) => sampleRoadPath(surface, anchorOf(r.a), anchorOf(r.b))),
  );
  // Red, green, blue and opacity per vertex, rewritten by `styleRoads`. The
  // positions never change.
  const roadColors = new THREE.BufferAttribute(
    new Float32Array((ribbon.positions.length / 3) * 4),
    4,
  );
  if (roads.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(ribbon.positions, 3),
    );
    geo.setAttribute("color", roadColors);
    geo.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Drawn just over the ground it lies on, and still hidden by a hill
      // that stands in front of it.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "roads";
    mesh.raycast = () => {};
    scene.add(mesh);
  }

  const styleRoads = () => {
    roads.forEach(({ a, b }, k) => {
      const state = roadStates.get(pairKey(a, b));
      const hiddenEnds = (isHidden(a) ? 1 : 0) + (isHidden(b) ? 1 : 0);
      let color = ROAD_NEUTRAL_COLOR;
      let opacity = 0;
      if (!state?.hidden && hiddenEnds < 2) {
        const owner = ownerOf(a);
        const shared =
          hiddenEnds === 0 && owner === ownerOf(b) && owner !== NEUTRAL;
        opacity = shared ? ROAD_OWNED_OPACITY : ROAD_OPACITY;
        if (shared) color = ownerColor(owner);
        if (state?.attackable) {
          color = ATTACKABLE_COLOR;
          opacity = ROAD_OWNED_OPACITY;
        }
        if (state?.travelled) {
          color = TRAVELLED_COLOR;
          opacity = ROAD_OWNED_OPACITY;
        }
        if (state?.emphasised) opacity = 1;
        opacity = Math.min(1, opacity * laneDim(a, b));
      }
      const [start, count] = ribbon.ranges[k];
      for (let v = start; v < start + count; v++) {
        roadColors.setXYZW(v, color.r, color.g, color.b, opacity);
      }
    });
    roadColors.needsUpdate = true;
  };

  /* ------------------------------ hit targets ---------------------------- */

  // The hit targets grow with the markers, so a marker enlarged at a far zoom
  // is as easy to click as it looks.
  const matrix = new THREE.Matrix4();
  const fitCores = () => {
    for (const m of markers) {
      const scale = (m.capital ? 2.6 : 2.0) * zoom;
      matrix
        .makeScale(scale, scale, scale)
        .setPosition(m.x, m.ground + MARKER_LIFT, m.z);
      cores.setMatrixAt(m.i, matrix);
    }
    cores.instanceMatrix.needsUpdate = true;
    cores.computeBoundingSphere();
  };

  const restyle = (id: string | null) => {
    const m = id === null ? undefined : markerById.get(id);
    if (m) style(m);
  };

  return {
    has: (nodeId) => markerById.has(nodeId),
    apply: () => {
      for (const m of markers) style(m);
      styleRoads();
    },
    select: (nodeId) => {
      const previous = selectedId;
      selectedId = nodeId;
      restyle(previous);
      restyle(nodeId);
    },
    hover: (nodeId) => {
      const previous = hoveredId;
      hoveredId = nodeId;
      restyle(previous);
      restyle(nodeId);
    },
    tick: (now) => {
      const m = selectedId === null ? undefined : markerById.get(selectedId);
      if (!m) return;
      const wave = Math.sin(now / 280);
      m.group.scale.setScalar(baseScale(m) * (SELECTED_SCALE + 0.06 * wave));
      m.top.color
        .copy(colorOf(m))
        .lerp(WHITE, 0.3 + 0.25 * wave)
        .multiplyScalar(dimOf(m.id));
    },
    fitToCamera: (distance) => {
      const next = Math.max(1, distance / GALAXY_MAX_DISTANCE);
      if (Math.abs(next - zoom) < 0.01) return;
      zoom = next;
      for (const m of markers) style(m);
      fitCores();
    },
    setLocationState: (nodeId, state) => {
      if (state) locationStates.set(nodeId, state);
      else locationStates.delete(nodeId);
    },
    setRoadState: (a, b, state) => {
      if (state) roadStates.set(pairKey(a, b), state);
      else roadStates.delete(pairKey(a, b));
    },
  };
}
