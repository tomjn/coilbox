/**
 * The recorded match's units as dots on the replay's 3D terrain.
 *
 * The data is the flat map's own: `collectScene` fills the same arrays from the
 * same track handle at the clock's frame. Only the drawing differs. Each unit is
 * one point in its team's colour, stood on the ground at its elmo position the
 * way the scenario editor's units are (`placement/unitsLayer.ts`): scene
 * position from `worldToScene`, height from the raw height field.
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

/** What the points hang off, so the layer can be found in the scene. */
const LAYER_NAME = "replay-unit-dots";

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
}

export interface UnitDotsLayer {
  /** Colour the teams in these styles from the next picture. */
  setTeams(teams: ReadonlyMap<number, TeamStyle>): void;
  /** Draws the clock's frame now. How many dots it drew, or null while the
   *  frame's window is still loading. */
  drawNow(): number | null;
  dispose(): void;
}

export function createUnitDotsLayer(deps: UnitDotsDeps): UnitDotsLayer {
  const { view, track, clock, ground, env } = deps;
  const collected = createMapScene();
  let colours = dotColours(deps.teams);
  let capacity = 0;
  let positions = new Float32Array(0);
  let rgb = new Float32Array(0);

  const material = new THREE.PointsMaterial({
    size: DOT_PIXELS,
    sizeAttenuation: false,
    vertexColors: true,
    alphaMap: dotTexture(),
    alphaTest: 0.5,
    // Drawn through the terrain so a unit behind a ridge is not lost, as the
    // scenario editor's marker boxes are.
    depthTest: false,
    transparent: true,
  });
  let geometry = new THREE.BufferGeometry();
  const points = new THREE.Points(geometry, material);
  points.name = LAYER_NAME;
  points.renderOrder = 2;
  // The geometry has no bounds until it is filled, and the dots span the map.
  points.frustumCulled = false;
  view.scene.add(points);

  /** A fresh geometry with room for `count` dots. The old one is disposed,
   *  because replacing an attribute leaves its buffer on the GPU. */
  const grow = (count: number) => {
    capacity = Math.max(count, capacity * 2, 256);
    positions = new Float32Array(capacity * 3);
    rgb = new Float32Array(capacity * 3);
    geometry.dispose();
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(rgb, 3).setUsage(THREE.DynamicDrawUsage),
    );
    points.geometry = geometry;
  };

  grow(0);

  let dirty = true;
  let pending: number | null = null;
  let disposed = false;

  const draw = (): number | null => {
    const frame = clock.frame;
    track.follow(frame, clock.direction);
    if (!collectScene(track, frame, collected)) return null;
    if (collected.units > capacity) grow(collected.units);
    const count = writeDotPositions(collected, ground, view.scale, positions);
    writeDotColours(collected, colours, rgb);
    const attributes = geometry.attributes;
    attributes.position.needsUpdate = true;
    attributes.color.needsUpdate = true;
    geometry.setDrawRange(0, count);
    view.render();
    return count;
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
    drawNow: draw,
    dispose() {
      disposed = true;
      if (pending !== null) env.cancelFrame(pending);
      pending = null;
      for (const stop of stops) stop();
      points.removeFromParent();
      geometry.dispose();
      material.alphaMap?.dispose();
      material.dispose();
      view.render();
    },
  };
}
