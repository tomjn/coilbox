import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { GalaxyDoc } from "../model";
import { NEUTRAL } from "../model";
import { factionSides } from "./factionShape";
import type { GroundLayer, RoadStyle } from "./groundLayer";
import { ROAD_MODE } from "./groundShader";
import { pairKey, roadLinks } from "./roads";
import { GALAXY_MIN_DISTANCE, type TerrainSurface } from "./terrain";
import type { TownLayer, TownStyle } from "./townLayer";

/**
 * Point locations and roads on a terrain map. A point location is a node with
 * no outline: a city, a base, a landing site. The place itself is a town
 * drawn on the ground (`townLayer.ts`), which says nothing about who
 * holds it, so each one also carries a badge on a short pole above it: a
 * piece of interface rather than of the ground, in its owner's colour and its
 * owner's faction shape, with a star for a capital. The badge faces the
 * camera and keeps much the same size on screen at every zoom. The links
 * `roadLinks` picks out are painted into the ground as tracks, and this
 * layer gives each one its state there.
 *
 * Every state reads by shape or size as well as colour: brackets round an
 * attackable badge, a bigger badge and a ring on the ground round a selected
 * or hovered town, and a hollow grey badge with no name for a place hidden by
 * fog. An incursion has its own warning sign over the place (`playLayer.ts`).
 *
 * Nothing here is built for a galaxy or theatre map, and a node with an
 * outline is left to the province drawing.
 *
 * Picking stays with the view's own hit targets (`cores`), sized here to
 * cover both the badge and the town under it, so hover and selection report
 * through the same `onSelect` as every other map. This layer only draws the
 * result, through {@link CityLayer.hover} and {@link CityLayer.select}.
 */

/** The badge's radius in world units at the closest zoom. */
export const BADGE_RADIUS = 0.36;
/** How far the badge's centre stands above the ground, in badge radii. */
export const POLE_RADII = 3;
/** A capital's badge is this much bigger, and ringed. */
export const CAPITAL_SCALE = 1.35;
/** Growth of a selected badge and of a hovered or emphasised one. */
const SELECTED_SCALE = 1.3;
const HOVER_SCALE = 1.15;
/** A badge hidden by fog is this much smaller: a place, and no more. */
const HIDDEN_SCALE = 0.8;
/**
 * How the badge grows as the camera pulls back: as the distance to this
 * power, so it is a little smaller on screen far out than close in.
 */
const ZOOM_POWER = 0.85;
/** Gap between a badge's edge and its name, in badge radii. */
const LABEL_GAP = 0.35;
/** How far south of a town's middle its name sits, in town radii. */
const LABEL_TOWN_SHARE = 0.55;
/** Sides of a round badge. */
const ROUND_SEGMENTS = 32;

const WHITE = new THREE.Color(0xffffff);
/** The badge's outline, dark so it stands off any ground. */
const RIM_COLOR = new THREE.Color(0x161a22);
/** A location or road hidden by fog: no owner shows through. */
const HIDDEN_COLOR = new THREE.Color(0x8a909c);
const HIDDEN_CORE = new THREE.Color(0x2a2e36);
const POLE_COLOR = new THREE.Color(0xe8e4d8);
/** Edge lines on a plain road while one of its ends is hovered. */
const ROAD_LIFT_COLOR = new THREE.Color(0xf4efe2);
/** The warm gold the galaxy's contested lanes use. */
const ATTACKABLE_COLOR = new THREE.Color(0xffcf8a);
/** The amber of the incursion warning marker. */
const THREATENED_COLOR = new THREE.Color(0xffb020);
/** The green of the galaxy's path already travelled. */
const TRAVELLED_COLOR = new THREE.Color(0x46e08a);
const ROAD_OWNED_STRENGTH = 0.9;
/** How strongly a plain road's edges show per unit of hover lift. */
const ROAD_LIFT_STRENGTH = 0.8;

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
   * Hidden by fog. A hidden location draws as a small hollow grey badge with
   * no name and no capital star, over a dim grey town. A hidden road is not
   * drawn. A road with one hidden end loses its owner colour, and one with
   * both ends hidden is not drawn either.
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
  /**
   * Keep badges a readable size: they grow with the camera's distance, so
   * they stay much the same size on screen. `distance` is from the camera to
   * the point it looks at.
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

/** How a badge's size follows the camera, 1 at the closest zoom. */
export function markerZoom(distance: number): number {
  return (Math.max(distance, 1) / GALAXY_MIN_DISTANCE) ** ZOOM_POWER;
}

/** How one location's badge and town are drawn. */
export interface MarkerLook {
  /** Faction shape, 0 for round. */
  sides: number;
  fill: THREE.Color;
  rim: THREE.Color;
  star: boolean;
  /** Brackets round the badge: it can be attacked. */
  brackets: boolean;
  /** Size against the plain badge. */
  scale: number;
  label: boolean;
  town: TownStyle;
}

/**
 * The look of one location for its state. `owner` is the owner's colour and
 * `sides` its faction shape, or undefined for no owner. `dim` is the view's
 * graded emphasis for the location, 0 to 1.
 */
export function markerLook(args: {
  state: MapItemState | undefined;
  owner: THREE.Color | undefined;
  sides: number;
  capital: boolean;
  selected: boolean;
  hovered: boolean;
  dim: number;
}): MarkerLook {
  const { state, owner, capital, selected, hovered, dim } = args;
  if (state?.hidden) {
    return {
      sides: 0,
      fill: HIDDEN_CORE.clone().multiplyScalar(dim),
      rim: HIDDEN_COLOR.clone().multiplyScalar(dim),
      star: false,
      brackets: false,
      scale: HIDDEN_SCALE,
      label: false,
      town: { hidden: true },
    };
  }
  const fill = (owner ?? HIDDEN_COLOR)
    .clone()
    .lerp(WHITE, hovered ? 0.3 : 0)
    .multiplyScalar(dim);
  let rim = RIM_COLOR.clone();
  if (state?.threatened) rim = THREATENED_COLOR.clone();
  else if (selected) rim = WHITE.clone();
  else if (state?.attackable) rim = ATTACKABLE_COLOR.clone();
  else if (state?.emphasised) rim = WHITE.clone().lerp(RIM_COLOR, 0.35);
  rim.multiplyScalar(dim);
  let town: TownStyle = { hidden: false };
  if (selected) {
    town = {
      hidden: false,
      ring: { color: WHITE, strength: 0.95, thick: true },
    };
  } else if (hovered) {
    town = {
      hidden: false,
      ring: { color: WHITE, strength: 0.7, thick: false },
    };
  } else if (state?.emphasised) {
    town = {
      hidden: false,
      ring: { color: WHITE, strength: 0.4, thick: false },
    };
  }
  return {
    sides: owner ? args.sides : 0,
    fill,
    rim,
    star: capital,
    brackets: !!state?.attackable,
    scale:
      (capital ? CAPITAL_SCALE : 1) *
      (selected
        ? SELECTED_SCALE
        : hovered || state?.emphasised
          ? HOVER_SCALE
          : 1),
    label: true,
    town,
  };
}

/* ------------------------------- geometry -------------------------------- */

/** Badge parts, the geometry groups of a badge in this order. */
const PART = { rim: 0, fill: 1, star: 2, brackets: 3, ring: 4 } as const;

/** A flat polygon in x and y with its first corner straight up. */
function polygon(
  out: number[],
  sides: number,
  radius: number,
  z: number,
): void {
  const n = sides || ROUND_SEGMENTS;
  for (let k = 0; k < n; k++) {
    const a = Math.PI / 2 + (k / n) * Math.PI * 2;
    const b = Math.PI / 2 + ((k + 1) / n) * Math.PI * 2;
    out.push(
      0,
      0,
      z,
      Math.cos(a) * radius,
      Math.sin(a) * radius,
      z,
      Math.cos(b) * radius,
      Math.sin(b) * radius,
      z,
    );
  }
}

/**
 * A badge of radius 1 in x and y facing +z, with a geometry group per
 * {@link PART}. The parts stand a little forward of each other, so they
 * never fight in depth and the pole behind stays behind.
 */
function badgeGeometry(sides: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const groups: [number, number][] = [];
  const part = (fill: () => void) => {
    const start = positions.length / 3;
    fill();
    groups.push([start, positions.length / 3 - start]);
  };
  // A polygon's corners reach the radius and its sides fall short, so a
  // shape with few sides is drawn a little larger to look as big as a disc.
  const reach = sides === 0 ? 1 : 1 / Math.cos(Math.PI / sides) ** 0.5;
  part(() => polygon(positions, sides, reach, 0.15));
  part(() => polygon(positions, sides, reach * 0.8, 0.17));
  part(() => {
    // A five point star.
    const rim: [number, number][] = [];
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 0.56 : 0.24;
      const a = Math.PI / 2 + (k / 10) * Math.PI * 2;
      rim.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let k = 0; k < 10; k++) {
      const [x1, y1] = rim[k];
      const [x2, y2] = rim[(k + 1) % 10];
      positions.push(0, 0, 0.19, x1, y1, 0.19, x2, y2, 0.19);
    }
  });
  part(() => {
    // Four corner brackets round the badge, as round a target.
    const at = 1.5;
    const len = 0.62;
    const w = 0.22;
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const quad = (x0: number, y0: number, x1: number, y1: number) => {
        const ax = sx * x0;
        const ay = sy * y0;
        const bx = sx * x1;
        const by = sy * y1;
        positions.push(ax, ay, 0.15, bx, ay, 0.15, bx, by, 0.15);
        positions.push(ax, ay, 0.15, bx, by, 0.15, ax, by, 0.15);
      };
      quad(at - w, at - len, at, at);
      quad(at - len, at - w, at - w, at);
    }
  });
  part(() => {
    // A capital's ring, clear of the badge's outline.
    const inner = reach * 1.12;
    const outer = reach * 1.3;
    for (let k = 0; k < ROUND_SEGMENTS; k++) {
      const a = (k / ROUND_SEGMENTS) * Math.PI * 2;
      const b = ((k + 1) / ROUND_SEGMENTS) * Math.PI * 2;
      const [ca, sa, cb, sb] = [
        Math.cos(a),
        Math.sin(a),
        Math.cos(b),
        Math.sin(b),
      ];
      positions.push(
        ca * inner,
        sa * inner,
        0.15,
        ca * outer,
        sa * outer,
        0.15,
      );
      positions.push(
        cb * outer,
        sb * outer,
        0.15,
        ca * inner,
        sa * inner,
        0.15,
      );
      positions.push(
        cb * outer,
        sb * outer,
        0.15,
        cb * inner,
        sb * inner,
        0.15,
      );
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  for (const [i, [start, count]] of groups.entries()) {
    geo.addGroup(start, count, i);
  }
  geo.computeBoundingSphere();
  return geo;
}

interface Marker {
  /** Index into `galaxy.nodes`. */
  i: number;
  id: string;
  capital: boolean;
  group: THREE.Group;
  pole: THREE.Mesh;
  badge: THREE.Mesh;
  mats: THREE.MeshBasicMaterial[];
  poleMat: THREE.MeshBasicMaterial;
  /** The anchor on the ground, in world units. */
  x: number;
  ground: number;
  z: number;
  /** The town's radius under the badge, 0 for none. */
  townRadius: number;
  /** The badge's size against a plain one, for the current state. */
  look: number;
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
  /** Where the roads and towns are painted, and their state with them. */
  ground: Pick<GroundLayer, "setRoadStyle" | "commit"> &
    Partial<Pick<TownLayer, "setTownStyle" | "towns">>,
): CityLayer {
  const nodeById = new Map(galaxy.nodes.map((n) => [n.id, n]));
  const ownerOf = (id: string): string =>
    ownersRef.current[id] ?? nodeById.get(id)?.owner ?? NEUTRAL;
  const locationStates = new Map<string, MapItemState>();
  const roadStates = new Map<string, MapItemState>();
  const isHidden = (id: string) => !!locationStates.get(id)?.hidden;

  /* ------------------------------- markers ------------------------------- */

  // One badge geometry per faction shape, shared and swapped on capture.
  const badgeGeos = new Map<number, THREE.BufferGeometry>();
  const badgeGeoFor = (sides: number) => {
    let geo = badgeGeos.get(sides);
    if (!geo) {
      geo = badgeGeometry(sides);
      badgeGeos.set(sides, geo);
      disposables.push(geo);
    }
    return geo;
  };
  // A pole one unit tall standing on its base.
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
  poleGeo.translate(0, 0.5, 0);
  disposables.push(poleGeo);

  let zoom = 1;
  let selectedId: string | null = null;
  let hoveredId: string | null = null;

  const radiusOf = (m: Marker) => BADGE_RADIUS * zoom * m.look;
  const poleOf = () => BADGE_RADIUS * zoom * POLE_RADII;

  /** Put a marker's name just below its badge on screen. */
  /**
   * Put a marker's name on the ground just south of the town's middle, clear
   * of the badge above it and of the square where its roads meet, and
   * further out as the badge grows with the zoom.
   */
  const placeLabel = (m: Marker) => {
    const label = labelObjects[m.i];
    if (!label) return;
    const drop = Math.max(
      m.townRadius * LABEL_TOWN_SHARE,
      radiusOf(m) * (1 + LABEL_GAP),
    );
    label.position.set(m.x, m.ground, m.z + drop);
    // Hang the name below that point instead of centring it on it.
    label.center.set(0.5, 0);
  };

  const markers: Marker[] = [];
  const markerById = new Map<string, Marker>();
  galaxy.nodes.forEach((n, i) => {
    if (n.outline) return;
    const [x, groundY, z] = surface.mapToWorld(n.pos[0], n.pos[1]);
    const mats = [0, 1, 2, 3, 4].map(() => new THREE.MeshBasicMaterial());
    const poleMat = new THREE.MeshBasicMaterial();
    disposables.push(...mats, poleMat);
    const group = new THREE.Group();
    group.name = `city-marker:${n.id}`;
    group.position.set(x, groundY, z);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.raycast = () => {};
    const badge = new THREE.Mesh(badgeGeoFor(0), mats);
    badge.raycast = () => {};
    // The badge turns to face the camera each time it is drawn.
    group.add(pole, badge);
    scene.add(group);
    const marker: Marker = {
      i,
      id: n.id,
      capital: n.kind === "capital",
      group,
      pole,
      badge,
      mats,
      poleMat,
      x,
      ground: groundY,
      z,
      townRadius: ground.towns?.[i]?.radius ?? 0,
      look: 1,
    };
    badge.onBeforeRender = (_r, _s, camera) => {
      badge.quaternion.copy(camera.quaternion);
      badge.updateMatrixWorld();
    };
    markers.push(marker);
    markerById.set(n.id, marker);
  });

  /** Size a marker's pole and badge for the zoom and its state. */
  const place = (m: Marker) => {
    const r = radiusOf(m);
    m.badge.scale.setScalar(r);
    m.badge.position.set(0, poleOf(), 0);
    m.pole.scale.set(zoom, poleOf(), zoom);
    placeLabel(m);
  };

  const style = (m: Marker) => {
    const state = locationStates.get(m.id);
    const owner = ownerOf(m.id);
    const look = markerLook({
      state,
      owner: owner === NEUTRAL ? undefined : ownerColor(owner),
      sides: owner === NEUTRAL ? 0 : factionSides(galaxy, owner),
      capital: m.capital,
      selected: m.id === selectedId,
      hovered: m.id === hoveredId,
      dim: dimOf(m.id),
    });
    m.badge.geometry = badgeGeoFor(look.sides);
    m.mats[PART.rim].color.copy(look.rim);
    m.mats[PART.fill].color.copy(look.fill);
    m.mats[PART.star].color.copy(WHITE).multiplyScalar(dimOf(m.id));
    m.mats[PART.star].visible = look.star;
    m.mats[PART.ring].color.copy(WHITE).multiplyScalar(dimOf(m.id));
    m.mats[PART.ring].visible = look.star;
    m.mats[PART.brackets].color.copy(ATTACKABLE_COLOR);
    m.mats[PART.brackets].visible = look.brackets;
    m.poleMat.color.copy(POLE_COLOR).multiplyScalar(dimOf(m.id));
    m.look = look.scale;
    const label = labelObjects[m.i];
    if (label) label.visible = look.label;
    ground.setTownStyle?.(m.i, look.town);
    place(m);
  };

  /* -------------------------------- roads -------------------------------- */

  const roads = roadLinks(galaxy);

  const styleRoads = () => {
    roads.forEach(({ a, b }, k) => {
      const hiddenEnds = (isHidden(a) ? 1 : 0) + (isHidden(b) ? 1 : 0);
      const owner = ownerOf(a);
      const shared =
        hiddenEnds === 0 && owner === ownerOf(b) && owner !== NEUTRAL;
      ground.setRoadStyle(
        k,
        roadStyle(
          roadStates.get(pairKey(a, b)),
          hiddenEnds,
          shared ? ownerColor(owner) : undefined,
          laneDim(a, b),
        ),
      );
    });
  };

  /* ------------------------------ hit targets ---------------------------- */

  // Each hit target covers the town on the ground and the badge above it, so
  // either picks the place. It grows with the badge as the camera pulls back.
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const size = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const fitCores = () => {
    for (const m of markers) {
      const r = BADGE_RADIUS * zoom * (m.capital ? CAPITAL_SCALE : 1);
      const top = poleOf() + r;
      const across = Math.max(m.townRadius * 0.85, r * 1.4);
      at.set(m.x, m.ground + top / 2, m.z);
      size.set(across, top / 2 + r * 0.3, across);
      cores.setMatrixAt(m.i, matrix.compose(at, turn, size));
    }
    cores.instanceMatrix.needsUpdate = true;
    cores.computeBoundingSphere();
  };
  fitCores();

  const restyle = (id: string | null) => {
    const m = id === null ? undefined : markerById.get(id);
    if (m) {
      style(m);
      ground.commit();
    }
  };

  return {
    has: (nodeId) => markerById.has(nodeId),
    apply: () => {
      for (const m of markers) style(m);
      styleRoads();
      ground.commit();
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
    fitToCamera: (distance) => {
      const next = markerZoom(distance);
      if (Math.abs(next - zoom) < 0.01 * zoom) return;
      zoom = next;
      for (const m of markers) place(m);
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

/**
 * How a road is drawn for its state. `hiddenEnds` counts its ends hidden by
 * fog, `owner` is the colour of the owner its two ends share, if they do, and
 * `dim` is the lane dimming the view passes in, above 1 while an end is
 * hovered.
 *
 * Each state draws differently as well as in its own colour: an owned road has
 * thin edge lines, one that can be attacked along glows, and one already
 * travelled is filled in. A road with both ends hidden is not drawn.
 */
export function roadStyle(
  state: MapItemState | undefined,
  hiddenEnds: number,
  owner: THREE.Color | undefined,
  dim: number,
): RoadStyle {
  const shown = !state?.hidden && hiddenEnds < 2;
  const style: RoadStyle = {
    shown,
    mode: ROAD_MODE.plain,
    color: ROAD_LIFT_COLOR,
    strength: 0,
    emphasised: !!state?.emphasised,
  };
  if (!shown) return style;
  if (state?.travelled) {
    style.mode = ROAD_MODE.filled;
    style.color = TRAVELLED_COLOR;
    style.strength = 1;
  } else if (state?.attackable) {
    style.mode = ROAD_MODE.glow;
    style.color = ATTACKABLE_COLOR;
    style.strength = 1;
  } else if (owner) {
    style.mode = ROAD_MODE.edges;
    style.color = owner;
    style.strength = ROAD_OWNED_STRENGTH;
  } else if (state?.emphasised || dim > 1) {
    // A plain road comes forward with its selected or hovered end.
    style.mode = ROAD_MODE.edges;
    style.strength = state?.emphasised ? 1 : (dim - 1) * ROAD_LIFT_STRENGTH;
    return style;
  }
  if (state?.emphasised) style.strength = 1;
  style.strength = Math.min(1, style.strength * dim);
  return style;
}
