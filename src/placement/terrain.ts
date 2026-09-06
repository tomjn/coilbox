/**
 * Reading the map's ground height on the CPU.
 *
 * The 3D preview puts the terrain's relief in a `displacementMap` sampled by the
 * vertex shader, so the geometry three.js holds is a flat plane: a raycast
 * against it comes back flat, and a model positioned from it floats or sinks.
 * So the same heights the shader displaces by are sampled here instead.
 *
 * Both readings come off one source, the worker's raw 16 bit grid (issues #1490
 * and #1730). It used to be two: a picture read back through a canvas for
 * standing models, and the grid for whether a building would stand. A canvas
 * hands back eight bits whatever the file holds, so the picture cost the check a
 * tolerance of one step of the map's whole range, and the two readings could
 * disagree about the same ground.
 *
 * The sampling is arithmetic and tested. Fetching the grid is not, because it
 * needs the asset protocol.
 */

import type { Ground } from "@/blueprint/buildable";
import { SQUARE_SIZE } from "@/blueprint/footprint";

/** A decoded heightmap: one 0..1 sample per vertex, row 0 at the map's north. */
export interface HeightField {
  width: number;
  height: number;
  /** Row-major, `width * height` samples, each 0..1 across the map's range. */
  samples: Float32Array;
}

/**
 * The map's heights as the engine holds them (issue #1490).
 *
 * The stored 16 bit words themselves, written out by the worker's
 * `--height-field` mode and fetched as raw bytes, so a verdict pays no
 * tolerance for the reading. {@link fieldFromGrid} turns them into the 0..1
 * samples the drawing wants.
 */
export interface HeightGrid {
  /** `(mapx+1)` by `(mapy+1)`: the engine's own corner grid, 8 elmos apart. */
  width: number;
  height: number;
  /** Row-major, `width * height` words, row 0 at the map's north. */
  words: Uint16Array;
}

/**
 * The worker's bytes as a grid, or `null` when they are not this map's.
 *
 * A file of the wrong length is some other map's heights or a read that went
 * wrong, and reading it anyway would put a building's verdict on ground that is
 * not under it.
 *
 * The words are little endian on disk, which is what a `Uint16Array` over the
 * buffer reads on every platform coilbox ships on.
 *
 * `words` is not enumerable. The grid travels as a prop to the map surface,
 * and React's development build diffs a component's props on every commit for
 * its performance timeline, walking any object it does not recognise key by
 * key. A typed array is one it does not recognise, so the half a million words
 * of a large map were being visited one at a time, two seconds on the main
 * thread before the scene could draw. A key the walk cannot see costs nothing,
 * and every reader here reaches the words by name.
 */
export function heightGrid(
  bytes: ArrayBuffer,
  width: number,
  height: number,
): HeightGrid | null {
  if (width <= 0 || height <= 0) return null;
  if (bytes.byteLength !== width * height * 2) return null;
  const grid = { width, height } as HeightGrid;
  Object.defineProperty(grid, "words", {
    value: new Uint16Array(bytes),
    enumerable: false,
  });
  return grid;
}

/** Fetch the worker's raw height grid, or `null` if it will not read. Tens of
 *  megabytes on a large map, which is why it is a file over the asset protocol
 *  rather than anything on the bridge. */
export async function readHeightGrid(
  src: string,
  width: number,
  height: number,
): Promise<HeightGrid | null> {
  return heightGrid(await (await fetch(src)).arrayBuffer(), width, height);
}

/**
 * The grid as the 0..1 samples a model is stood on.
 *
 * The same numbers {@link cornerGround} reads, at the same resolution, so a
 * model and the verdict on the building under it are drawn from one reading of
 * the ground (issue #1730). 65536 rather than 65535 because that is
 * `CSMFMapFile::ReadHeightmap`'s own divisor.
 *
 * It costs a float per sample, which is 17 MB on the largest map in the corpus,
 * on top of the words themselves. That is the price of one map being open, and
 * the alternative was a second, shallower reading of the same ground.
 */
export function fieldFromGrid(grid: HeightGrid): HeightField {
  const samples = new Float32Array(grid.words.length);
  for (let i = 0; i < samples.length; i++) samples[i] = grid.words[i] / 65536;
  return { width: grid.width, height: grid.height, samples };
}

/**
 * The map's ground on the engine's own grid, or `null` when this grid cannot
 * describe it.
 *
 * {@link groundHeight} answers "how high is the ground at this point", which is
 * what a model standing somewhere needs. Whether a building will stand needs the
 * other thing: the heightmap's own corners, at the 8 elmo spacing the engine
 * measures them at, because the rule is arithmetic over those exact values.
 *
 * The arithmetic is `CSMFMapFile::ReadHeightmap`'s own:
 * `minHeight + word * (maxHeight - minHeight) / 65536`. Both ends of that come
 * from unitsync, which honours the same `mapinfo.lua` overrides the engine does,
 * so the number here is the number the engine holds and `slack` is nothing.
 *
 * `null` when the grid is not the map's corners. That is a file describing some
 * other map rather than a smoothed picture of this one, so there is nothing to
 * scale and no tolerance that would make it honest.
 */
export function cornerGround(
  grid: HeightGrid,
  worldWidth: number,
  worldHeight: number,
  minHeight: number,
  maxHeight: number,
): Ground | null {
  if (worldWidth <= 0 || worldHeight <= 0) return null;
  if (grid.width !== worldWidth / SQUARE_SIZE + 1) return null;
  if (grid.height !== worldHeight / SQUARE_SIZE + 1) return null;
  const step = (maxHeight - minHeight) / 65536;
  return {
    cornerAt: (x, z) => wordAt(grid, x, z) * step + minHeight,
    slack: 0,
    minHeight,
    maxHeight,
    hasWater: true,
  };
}

/** One word by corner, clamped to the grid so an edge corner still reads, the
 *  way the engine clamps one. */
function wordAt(grid: HeightGrid, col: number, row: number): number {
  const c = Math.min(grid.width - 1, Math.max(0, col));
  const r = Math.min(grid.height - 1, Math.max(0, row));
  return grid.words[r * grid.width + c];
}

/** Ground with no relief: one sample, at nothing. Sampled through the same
 *  bilinear read a map is, which answers the map's own floor everywhere. */
export const FLAT_FIELD: HeightField = {
  width: 1,
  height: 1,
  samples: Float32Array.of(0),
};

/**
 * The heights the models are drawn on, which are not always the heights the
 * check is given (issue #1497).
 *
 * A map whose heightmap will not read leaves the field null forever, and a layer
 * built from nothing draws nothing: the map came up with its zones, its paths,
 * its start positions and its footprint squares, and not one unit on it. An
 * author looking at that had no way to tell "this scenario has nothing in it"
 * from "the ground could not be read, so nothing could be stood on it".
 *
 * So once the read has finished and failed, the models stand on the flat. Every
 * other part of the document still draws, the editor still works, and the
 * surface says why everything is level.
 *
 * The check is not given this. Flat ground invented because the real ground
 * would not read is not ground, and a building on it must keep its dashed square
 * rather than collect a verdict from a floor that is not there.
 */
export function standingField(
  field: HeightField | null,
  /** Whether the read has finished, one way or the other. Null before it has is
   *  a read in flight, and there is nothing to stand anything on yet. */
  read: boolean,
): HeightField | null {
  return field ?? (read ? FLAT_FIELD : null);
}

/**
 * Ground with no relief, which is the standalone editor's build grid.
 *
 * Known, level and exact, so every building on it gets a real verdict. Without
 * this the mapless editor would have no ground at all and would draw every
 * building as one nothing had judged, which is true of a map that would not read
 * and is not true of a floor that is flat on purpose (issue #1491).
 *
 * No water on it either. The floor sits at 0, which on a map is the water's
 * surface, and a depth check reading it that way would mark every naval
 * building in a layout that is only a shape (issue #1459).
 */
export function flatGround(): Ground {
  return {
    cornerAt: () => 0,
    slack: 0,
    minHeight: 0,
    maxHeight: 0,
    hasWater: false,
  };
}

/** A sample by pixel, clamped to the field so an edge position still reads. */
function sampleAt(field: HeightField, col: number, row: number): number {
  const c = Math.min(field.width - 1, Math.max(0, col));
  const r = Math.min(field.height - 1, Math.max(0, row));
  return field.samples[r * field.width + c];
}

/**
 * The ground height in engine world units at an engine position.
 *
 * Bilinear, because a unit stands wherever it was put and the samples are 8
 * elmos apart. Nearest would make a row of units along a slope step up and down
 * in 8 elmo jumps. `minHeight` and `maxHeight` are the map's own range, the same
 * pair the preview scales its displacement by.
 */
export function groundHeight(
  field: HeightField,
  worldX: number,
  worldZ: number,
  worldWidth: number,
  worldHeight: number,
  minHeight: number,
  maxHeight: number,
): number {
  const u = Math.min(1, Math.max(0, worldWidth > 0 ? worldX / worldWidth : 0));
  const v = Math.min(
    1,
    Math.max(0, worldHeight > 0 ? worldZ / worldHeight : 0),
  );
  const x = u * (field.width - 1);
  const z = v * (field.height - 1);
  const col = Math.floor(x);
  const row = Math.floor(z);
  const fx = x - col;
  const fz = z - row;
  const top =
    sampleAt(field, col, row) * (1 - fx) + sampleAt(field, col + 1, row) * fx;
  const bottom =
    sampleAt(field, col, row + 1) * (1 - fx) +
    sampleAt(field, col + 1, row + 1) * fx;
  const norm = top * (1 - fz) + bottom * fz;
  return norm * (maxHeight - minHeight) + minHeight;
}
