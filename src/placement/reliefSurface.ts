/**
 * Putting a {@link Relief} on the ground of a built scene (issue #4794).
 *
 * Both grounds the blueprint editor draws on, the flat grid and a map, displace
 * their plane by a float texture of heights. So a change to the steps is a
 * change to a few samples of that texture and one upload, and nothing about the
 * scene is rebuilt: the camera stays where it was and nothing is read again.
 */

import * as THREE from "three";

import type { MapScene3D } from "@/lib/mapScene";
import {
  decimationFor,
  type Relief,
  type ReliefChange,
  writeDisplacement,
} from "./terrainRelief";

/** The heights the displacement texture's 0 and 1 stand for. */
export interface HeightRange {
  min: number;
  max: number;
}

/** The texture the scene's ground is displaced by, or null when it has none the
 *  relief can be written into: a map drawn from a picture of its heights. */
function displacementOf(
  handle: MapScene3D,
): { texture: THREE.DataTexture; data: Float32Array } | null {
  const texture = handle.terrain?.material.displacementMap;
  if (!(texture instanceof THREE.DataTexture)) return null;
  const data = texture.image.data;
  return data instanceof Float32Array ? { texture, data } : null;
}

/**
 * Draw the corners an update changed.
 *
 * `blend` eases from the ground before the update (0) to the ground after it
 * (1), for a step rising or falling in front of the viewer. Without it the
 * ground is drawn as it now is. Returns false when this scene's ground cannot
 * show relief.
 */
export function drawRelief(
  handle: MapScene3D,
  relief: Relief,
  change: ReliefChange,
  range: HeightRange,
  blend?: number,
): boolean {
  const target = displacementOf(handle);
  if (!target) return false;
  const { texture, data } = target;
  const { rect } = change;
  if (rect) {
    const w = rect.c1 - rect.c0 + 1;
    const from = change.before;
    const eased = blend !== undefined && from !== null && blend < 1;
    const height = eased
      ? (i: number) => {
          const c = (i % relief.width) - rect.c0;
          const r = Math.floor(i / relief.width) - rect.r0;
          const was = from[r * w + c];
          return was + (relief.heights[i] - was) * blend;
        }
      : (i: number) => relief.heights[i];
    writeDisplacement(
      data,
      decimationFor(relief, texture.image),
      relief,
      rect,
      height,
      range.min,
      range.max,
    );
    texture.needsUpdate = true;
  }
  // A map's plane is lit as flat, which hides the relief that was just put on
  // it. Lit by the shape it has, a raised wall shows.
  const material = handle.terrain?.material;
  if (material && !material.flatShading) {
    material.flatShading = true;
    material.needsUpdate = true;
  }
  handle.render();
  return true;
}

/** How long a step takes to rise or fall in Watch it go up, in ms. Under the
 *  pace buildings arrive at, so the ground is done before the next one. */
export const EASE_MS = 500;

/**
 * Ease the ground from before an update to after it, and return how to stop.
 *
 * The caller has already updated the relief, so everything that reads the
 * heights (the verdicts, the models) sees the finished ground at once. This is
 * only the picture, which is why a drawing that wants no motion calls
 * {@link drawRelief} once instead.
 */
export function easeRelief(
  handle: MapScene3D,
  relief: Relief,
  change: ReliefChange,
  range: HeightRange,
  ms = EASE_MS,
): () => void {
  if (!change.rect || !change.before) {
    drawRelief(handle, relief, change, range);
    return () => {};
  }
  const started = performance.now();
  let frame: number | null = null;
  const step = () => {
    frame = null;
    const at = Math.min(1, (performance.now() - started) / ms);
    // Slow at both ends, so a wall does not start and stop as a block.
    const eased = at * at * (3 - 2 * at);
    drawRelief(handle, relief, change, range, eased);
    if (at < 1) frame = requestAnimationFrame(step);
  };
  step();
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    // Left on the finished ground, never part way.
    drawRelief(handle, relief, change, range);
  };
}
