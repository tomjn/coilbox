/**
 * The recorded match's units on the replay's 3D terrain, as the game's own map
 * icons, or as dots for a unit with no icon and while the icons load.
 *
 * The data is the flat map's own: `collectScene` fills the same arrays from the
 * same track handle at the clock's frame. Only the drawing differs. Each unit is
 * one point in its team's colour, stood on the ground at its elmo position the
 * way the scenario editor's units are (`placement/unitsLayer.ts`): scene
 * position from `worldToScene`, height from the raw height field. Units of one
 * icon type share one `THREE.Points`, whose picture is tinted by each unit's
 * colour the way the engine and the flat map tint it.
 *
 * The layer draws when the clock moves or a window of the track arrives, once
 * per animation frame however many of those came first, and asks for no frame
 * while nothing changes.
 */

import * as THREE from "three";

import type { MapScene3D } from "@/lib/mapScene";
import { worldToScene } from "@/placement/scene";
import { groundHeight, type HeightField } from "@/placement/terrain";
import type { ReplayTrackHandle } from "../replayTrack";
import type { ReplayClock } from "./clock";
import { createDeathBlasts } from "./deathBlasts3d";
import type { UnitIcons } from "./icons";
import type { MapViewEnv } from "./loop";
import type { TeamStyle } from "./paint";
import { collectScene, createMapScene, type MapScene } from "./scene";

/** The ground the dots stand on: the map's extent in elmos, its relief and the
 *  pair of heights the terrain's displacement is scaled by. */
export interface DotGround {
  field: HeightField;
  worldWidth: number;
  worldHeight: number;
  minHeight: number;
  maxHeight: number;
}

/** How wide a dot is on screen, in CSS pixels. The same at any camera distance,
 *  so a unit is as findable on the whole map as close up. */
export const DOT_PIXELS = 7;

/** The colour of a team the style table does not know. */
const UNKNOWN_TEAM = "#888888";

/** What the dots hang off, so the layer can be found in the scene. */
export const DOTS_NAME = "replay-unit-dots";
/** What the points of one icon type hang off, followed by the type's name. */
export const ICONS_NAME = "replay-unit-icons:";

/**
 * Writes where each of the scene's units stands, as `x, y, z` in scene space,
 * into `out`. Returns how many it wrote.
 *
 * `out` must hold `3 * scene.units` numbers.
 */
export function writeDotPositions(
  scene: MapScene,
  ground: DotGround,
  sceneScale: number,
  out: Float32Array,
): number {
  for (let i = 0; i < scene.units; i++) {
    const at = worldToScene(
      { x: scene.unitX[i], z: scene.unitZ[i] },
      ground.worldWidth,
      ground.worldHeight,
      sceneScale,
    );
    const height = groundHeight(
      ground.field,
      scene.unitX[i],
      scene.unitZ[i],
      ground.worldWidth,
      ground.worldHeight,
      ground.minHeight,
      ground.maxHeight,
    );
    out[i * 3] = at.x;
    out[i * 3 + 1] = height * sceneScale;
    out[i * 3 + 2] = at.z;
  }
  return scene.units;
}

/** Linear red, green and blue for each team: a team the table does not know is
 *  grey, and a faint team is darker by its share of the style's alpha. */
export function dotColours(
  teams: ReadonlyMap<number, TeamStyle>,
): Map<number, [number, number, number]> {
  const out = new Map<number, [number, number, number]>();
  for (const [team, style] of teams) {
    const colour = new THREE.Color(style.fill);
    const k = style.alpha ?? 1;
    out.set(team, [colour.r * k, colour.g * k, colour.b * k]);
  }
  return out;
}

/** Writes each unit's team colour, three numbers a unit, into `out`. */
export function writeDotColours(
  scene: MapScene,
  colours: ReadonlyMap<number, [number, number, number]>,
  out: Float32Array,
): void {
  const grey = new THREE.Color(UNKNOWN_TEAM);
  for (let i = 0; i < scene.units; i++) {
    const rgb = colours.get(scene.unitTeam[i]);
    out[i * 3] = rgb ? rgb[0] : grey.r;
    out[i * 3 + 1] = rgb ? rgb[1] : grey.g;
    out[i * 3 + 2] = rgb ? rgb[2] : grey.b;
  }
}

/** A round dot's cut-out: opaque inside the circle, clear outside it. */
function dotTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = Math.hypot(x + 0.5 - r, y + 0.5 - r) <= r;
      const at = (y * size + x) * 4;
      data[at] = data[at + 1] = data[at + 2] = 255;
      data[at + 3] = inside ? 255 : 0;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export interface UnitDotsDeps {
  /** The 3D view's scene, as `MapPreview3D` hands it over. */
  view: MapScene3D;
  /** The one open track, shared with the flat map. */
  track: ReplayTrackHandle;
  clock: ReplayClock;
  teams: ReadonlyMap<number, TeamStyle>;
  ground: DotGround;
  env: MapViewEnv;
  /** The game's map icons. Null draws every unit as a dot. */
  icons?: UnitIcons | null;
  /** Mark where units died, as the flat map's Explosions switch says. Left
   *  out it is off. */
  explosions?: boolean;
}

export interface UnitDotsLayer {
  /** Colour the teams in these styles from the next picture. */
  setTeams(teams: ReadonlyMap<number, TeamStyle>): void;
  /** Draw units as these icons from the next picture, or all as dots. */
  setIcons(icons: UnitIcons | null): void;
  /** Mark where units died from the next picture, or not. */
  setExplosions(on: boolean): void;
  /** Draws the clock's frame now. How many units it drew, or null while the
   *  frame's window is still loading. */
  drawNow(): number | null;
  dispose(): void;
}

/** One `THREE.Points` with buffers for as many units as it has room for. */
interface Group {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  texture: THREE.Texture;
  geometry: THREE.BufferGeometry;
  capacity: number;
  positions: Float32Array;
  rgb: Float32Array;
  /** How many units it draws in the picture being filled. */
  count: number;
}

function createGroup(
  name: string,
  size: number,
  texture: THREE.Texture,
  icon: boolean,
): Group {
  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,
    vertexColors: true,
    // A dot is a cut-out of its colour. An icon's picture is multiplied by
    // the colour, which is how the engine tints it.
    ...(icon
      ? { map: texture, alphaTest: 0.1 }
      : { alphaMap: texture, alphaTest: 0.5 }),
    // Drawn through the terrain so a unit behind a ridge is not lost, as the
    // scenario editor's marker boxes are.
    depthTest: false,
    transparent: true,
  });
  const geometry = new THREE.BufferGeometry();
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.renderOrder = 2;
  // The geometry has no bounds until it is filled, and the units span the map.
  points.frustumCulled = false;
  return {
    points,
    material,
    texture,
    geometry,
    capacity: 0,
    positions: new Float32Array(0),
    rgb: new Float32Array(0),
    count: 0,
  };
}

/** A fresh geometry with room for `count` units. The old one is disposed,
 *  because replacing an attribute leaves its buffer on the GPU. */
function growGroup(group: Group, count: number): void {
  group.capacity = Math.max(count, group.capacity * 2, 256);
  group.positions = new Float32Array(group.capacity * 3);
  group.rgb = new Float32Array(group.capacity * 3);
  group.geometry.dispose();
  group.geometry = new THREE.BufferGeometry();
  group.geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(group.positions, 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  group.geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(group.rgb, 3).setUsage(THREE.DynamicDrawUsage),
  );
  group.points.geometry = group.geometry;
}

function disposeGroup(group: Group): void {
  group.points.removeFromParent();
  group.geometry.dispose();
  group.texture.dispose();
  group.material.dispose();
}

export function createUnitDotsLayer(deps: UnitDotsDeps): UnitDotsLayer {
  const { view, track, clock, ground, env } = deps;
  const collected = createMapScene();
  let colours = dotColours(deps.teams);
  let icons = deps.icons ?? null;
  let allPositions = new Float32Array(0);
  let allRgb = new Float32Array(0);

  const dots = createGroup(DOTS_NAME, DOT_PIXELS, dotTexture(), false);
  growGroup(dots, 0);
  view.scene.add(dots.points);
  let explosions = deps.explosions ?? false;
  const blasts = createDeathBlasts(view.scale);
  view.scene.add(blasts.points);
  /** The points of each icon type, made when a unit of that type is first
   *  drawn. */
  const iconGroups = new Map<string, Group>();
  /** The group each unit definition is drawn in. */
  const groupOfDef = new Map<number, Group>();

  const groupOf = (def: number): Group => {
    let group = groupOfDef.get(def);
    if (group) return group;
    const type = icons?.type(def) ?? null;
    if (!type) {
      group = dots;
    } else {
      group = iconGroups.get(type.name);
      if (!group) {
        const texture = new THREE.Texture(type.picture);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        group = createGroup(ICONS_NAME + type.name, type.edge, texture, true);
        growGroup(group, 0);
        view.scene.add(group.points);
        iconGroups.set(type.name, group);
      }
    }
    groupOfDef.set(def, group);
    return group;
  };

  /** Shots landing are left to the flat map, which draws the shots too. */
  const writeDeaths = () => {
    let deaths = 0;
    for (let i = 0; i < collected.blasts; i++) {
      if (collected.blastDeath[i]) deaths++;
    }
    const out = blasts.reserve(deaths);
    let n = 0;
    for (let i = 0; i < collected.blasts; i++) {
      if (!collected.blastDeath[i]) continue;
      const x = collected.blastX[i];
      const z = collected.blastZ[i];
      const at = worldToScene(
        { x, z },
        ground.worldWidth,
        ground.worldHeight,
        view.scale,
      );
      out.positions[n * 3] = at.x;
      out.positions[n * 3 + 1] =
        groundHeight(
          ground.field,
          x,
          z,
          ground.worldWidth,
          ground.worldHeight,
          ground.minHeight,
          ground.maxHeight,
        ) * view.scale;
      out.positions[n * 3 + 2] = at.z;
      out.progress[n] = collected.blastProgress[i];
      n++;
    }
    blasts.show(n);
  };

  const dropIcons = () => {
    for (const group of iconGroups.values()) disposeGroup(group);
    iconGroups.clear();
    groupOfDef.clear();
  };

  let dirty = true;
  let pending: number | null = null;
  let disposed = false;

  const draw = (): number | null => {
    const frame = clock.frame;
    track.follow(frame, clock.direction);
    if (!collectScene(track, frame, collected, explosions)) return null;
    writeDeaths();
    const units = collected.units;
    if (allPositions.length < units * 3) {
      allPositions = new Float32Array(units * 3);
      allRgb = new Float32Array(units * 3);
    }
    writeDotPositions(collected, ground, view.scale, allPositions);
    writeDotColours(collected, colours, allRgb);

    for (const group of [dots, ...iconGroups.values()]) group.count = 0;
    const of: Group[] = new Array(units);
    for (let i = 0; i < units; i++) {
      const group = groupOf(collected.unitDef[i]);
      of[i] = group;
      group.count++;
    }
    // Read again, as counting can make the group of a type first seen now.
    for (const group of [dots, ...iconGroups.values()]) {
      if (group.count > group.capacity) growGroup(group, group.count);
      group.count = 0;
    }
    for (let i = 0; i < units; i++) {
      const group = of[i];
      const at = group.count * 3;
      for (let k = 0; k < 3; k++) {
        group.positions[at + k] = allPositions[i * 3 + k];
        group.rgb[at + k] = allRgb[i * 3 + k];
      }
      group.count++;
    }
    for (const group of [dots, ...iconGroups.values()]) {
      const attributes = group.geometry.attributes;
      attributes.position.needsUpdate = true;
      attributes.color.needsUpdate = true;
      group.geometry.setDrawRange(0, group.count);
    }
    view.render();
    return units;
  };

  const tick = () => {
    pending = null;
    if (disposed || !dirty) return;
    dirty = false;
    draw();
  };

  const invalidate = () => {
    dirty = true;
    if (disposed || pending !== null) return;
    pending = env.requestFrame(tick);
  };

  const stops = [clock.subscribe(invalidate), track.subscribe(invalidate)];
  invalidate();

  return {
    setTeams(next) {
      colours = dotColours(next);
      invalidate();
    },
    setIcons(next) {
      if (next === icons) return;
      icons = next;
      dropIcons();
      invalidate();
    },
    setExplosions(next) {
      if (next === explosions) return;
      explosions = next;
      invalidate();
    },
    drawNow: draw,
    dispose() {
      disposed = true;
      if (pending !== null) env.cancelFrame(pending);
      pending = null;
      for (const stop of stops) stop();
      dropIcons();
      disposeGroup(dots);
      blasts.dispose();
      view.render();
    },
  };
}
