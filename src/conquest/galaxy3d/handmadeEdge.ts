import type { HeightGrid } from "./terrain";
import type { ColorPixels } from "./terrainMesh";

/**
 * The ground just past the frame of a hand-made map (issue #3656).
 *
 * A generated map draws more of its own land past its edge (#3648). A
 * hand-made map has no generator to continue, so it gets a short apron: the
 * ground carries on at the edge's height and eases down to the lowest ground
 * on the frame, coloured by the picture's own edge, and the haze in the
 * terrain shader fades it out by the apron's end. A raised edge is then a
 * slope that falls away rather than a cut with nothing under it.
 *
 * The apron is the same wider heightmap and picture, with the map in the
 * middle, that a generated map's margin uses, so the two are drawn the one
 * way. Kept short on purpose: a picture's edge stretched outward reads as
 * slabs over any real distance, so the haze has to finish before it can.
 */

/**
 * How far the apron reaches past the frame, as a share of the heightmap's
 * longer side. A design value: far enough for a raised edge to fall away
 * without a cliff, short enough that the stretched edge colour never reads
 * as a slab before the haze has taken it.
 */
export const APRON_SHARE = 0.08;

/** Heightmap pixels of apron past every side of a grid. */
export function apronPixels(grid: Pick<HeightGrid, "width" | "height">) {
  return Math.max(
    2,
    Math.ceil(APRON_SHARE * Math.max(grid.width, grid.height)),
  );
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * `grid` with `margin` pixels of apron round it. Each apron pixel starts at
 * the height of the nearest pixel on the map's edge and eases down to the
 * lowest height on the frame, reaching it `margin` pixels out. The map's own
 * pixels are untouched in the middle.
 */
export function apronHeights(grid: HeightGrid, margin: number): HeightGrid {
  const { data, width, height } = grid;
  let base = Number.POSITIVE_INFINITY;
  for (let x = 0; x < width; x++) {
    base = Math.min(base, data[x], data[(height - 1) * width + x]);
  }
  for (let y = 0; y < height; y++) {
    base = Math.min(base, data[y * width], data[y * width + width - 1]);
  }
  const across = width + 2 * margin;
  const down = height + 2 * margin;
  const out = new Float32Array(across * down);
  for (let y = 0; y < down; y++) {
    const gy = y - margin;
    const cy = Math.min(height - 1, Math.max(0, gy));
    for (let x = 0; x < across; x++) {
      const gx = x - margin;
      const cx = Math.min(width - 1, Math.max(0, gx));
      const edge = data[cy * width + cx];
      const past = Math.hypot(gx - cx, gy - cy);
      const ease = smoothstep(Math.min(1, past / margin));
      out[y * across + x] = edge + (base - edge) * ease;
    }
  }
  return { data: out, width: across, height: down };
}

/**
 * A flat grid for a map with no heightmap, so it still gets an apron to haze
 * out its frame. Its pixel count only sets how finely the apron's width is
 * measured, so 64 along the longer side is plenty.
 */
export function flatGrid(worldWidth: number, worldDepth: number): HeightGrid {
  const long = 64;
  const width =
    worldWidth >= worldDepth
      ? long
      : Math.max(2, Math.round((long * worldWidth) / worldDepth));
  const height =
    worldDepth >= worldWidth
      ? long
      : Math.max(2, Math.round((long * worldDepth) / worldWidth));
  return { data: new Float32Array(width * height), width, height };
}

/**
 * The map picture widened to match an apron of `margin` pixels round a
 * heightmap of `gridWidth` by `gridHeight`, so the same picture coordinates
 * land on both. Each pixel past the frame takes the colour of the nearest
 * pixel on the picture's edge.
 */
export function apronPicture(
  picture: ColorPixels,
  gridWidth: number,
  gridHeight: number,
  margin: number,
): ColorPixels {
  const { data, width, height } = picture;
  const mx = Math.round((margin * width) / gridWidth);
  const my = Math.round((margin * height) / gridHeight);
  const across = width + 2 * mx;
  const down = height + 2 * my;
  const out = new Uint8ClampedArray(across * down * 4);
  for (let y = 0; y < down; y++) {
    const cy = Math.min(height - 1, Math.max(0, y - my));
    for (let x = 0; x < across; x++) {
      const cx = Math.min(width - 1, Math.max(0, x - mx));
      const from = (cy * width + cx) * 4;
      out.set(data.subarray(from, from + 4), (y * across + x) * 4);
    }
  }
  return { data: out, width: across, height: down };
}

/**
 * The commonest colour on a picture's outermost ring of pixels, as 0 to 255
 * per channel, which is what the apron hazes to and the background is. An
 * average would pull a sea edge towards the colour of a hill on the frame, and
 * the sea at the edge would then stand out against the background as a band.
 * Colours are grouped to 16 levels a channel so a painted picture's grain
 * still counts as one colour, and the group's own average is returned.
 */
export function commonEdgeColor(
  picture: ColorPixels,
): [number, number, number] {
  const { data, width, height } = picture;
  const groups = new Map<number, [number, number, number, number]>();
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const key =
      ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const group = groups.get(key) ?? [0, 0, 0, 0];
    group[0] += data[i];
    group[1] += data[i + 1];
    group[2] += data[i + 2];
    group[3]++;
    groups.set(key, group);
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }
  let best: [number, number, number, number] = [0, 0, 0, 1];
  for (const group of groups.values()) if (group[3] > best[3]) best = group;
  return [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
}

/** A loaded image, canvas or bitmap read back as raw pixels. */
export function drawnPixels(
  source: CanvasImageSource & { width: number; height: number },
): ColorPixels {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(source, 0, 0);
  const { data, width, height } = ctx.getImageData(
    0,
    0,
    source.width,
    source.height,
  );
  return { data, width, height };
}
