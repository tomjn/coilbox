/**
 * Packing many small textures into one sheet (issue #2311).
 *
 * A Total Annihilation `.3do` paints every face from its own small tile out of
 * `unittextures/tatex/`, so a unit names about thirty textures and needs about
 * thirty materials however its meshes are grouped. Thirty materials is thirty
 * draw calls per unit on the map. Packing the tiles into one sheet and pointing
 * the faces into it leaves one material, which is what an `.s3o` already costs.
 *
 * The packing is kept away from three and away from the model reader on purpose:
 * it is rectangles in, rectangles out. `unitModel.ts` uses it to draw with, and
 * a `.3do` to `.s3o` conversion needs the same sheet built the same way.
 *
 * Shelf packing, tallest first. Thirty tiles of 32 to 128 pixels is a small
 * enough problem that a better packer would win nothing worth the code: the
 * whole of Balanced Annihilation's `tatex` folder is 126 tiles that fit in a
 * 1024 square with room to spare.
 */

/** Where one tile sits in the sheet, in pixels from the top left. */
export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A sheet and where everything in it went. `rects` is in the order asked for. */
export interface AtlasLayout {
  width: number;
  height: number;
  rects: AtlasRect[];
}

/** The width and height of one tile to pack. */
export interface TileSize {
  w: number;
  h: number;
}

/**
 * How many pixels of the tile's own edge are repeated around it.
 *
 * Sampling a sheet at a distance reads a neighbourhood rather than a texel, so
 * a tile packed flush against the next one shows the next one's colour along
 * its edge. Repeating the edge outwards gives the neighbourhood something of the
 * tile's own to read. Eight pixels covers mip levels 0 to 3, which is the tile
 * down to an eighth of its size.
 */
export const ATLAS_PADDING = 8;

/** Past this the sheet is not worth building, and the caller draws as it did. */
export const ATLAS_MAX_SIDE = 2048;

/** The smallest power of two that is at least `n`. */
function upToPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * Shelf-pack `sizes` into a sheet, padding each tile on every side.
 *
 * Nothing when it will not fit in `maxSide`, so a model with more art than a
 * sheet can hold falls back to drawing a texture at a time rather than to a
 * sheet with tiles missing from it.
 *
 * Every power-of-two width wide enough for the widest tile is tried, and the one
 * giving the smallest sheet wins. The widths are few and the tiles are few, so
 * trying them all is cheaper than reasoning about which to pick.
 *
 * Squarest wins a tie on area, and ties are the common case rather than the odd
 * one: rounding both sides up to a power of two means doubling the width usually
 * halves the height exactly. Without the tie-break, thirty-two 32-pixel tiles
 * come out as a 64 by 2048 strip instead of a 256 by 512 sheet.
 */
export function packTiles(
  sizes: TileSize[],
  padding = ATLAS_PADDING,
  maxSide = ATLAS_MAX_SIDE,
): AtlasLayout | null {
  if (sizes.length === 0) return null;

  const cells = sizes.map((size, index) => ({
    index,
    w: size.w + padding * 2,
    h: size.h + padding * 2,
  }));
  if (cells.some((cell) => cell.w > maxSide || cell.h > maxSide)) return null;
  // Tallest first, so a shelf is set by its tallest tile and the short ones fill
  // in beside it rather than each starting a shelf of its own.
  const tallestFirst = [...cells].sort((a, b) => b.h - a.h);
  const widest = Math.max(...cells.map((cell) => cell.w));

  let best: AtlasLayout | null = null;
  for (let width = upToPowerOfTwo(widest); width <= maxSide; width *= 2) {
    const rects: AtlasRect[] = new Array(sizes.length);
    let shelfY = 0;
    let shelfHeight = 0;
    let penX = 0;
    for (const cell of tallestFirst) {
      if (penX + cell.w > width) {
        shelfY += shelfHeight;
        shelfHeight = 0;
        penX = 0;
      }
      rects[cell.index] = {
        x: penX + padding,
        y: shelfY + padding,
        w: cell.w - padding * 2,
        h: cell.h - padding * 2,
      };
      penX += cell.w;
      shelfHeight = Math.max(shelfHeight, cell.h);
    }
    const height = upToPowerOfTwo(shelfY + shelfHeight);
    if (height > maxSide) continue;
    if (!best || better(width, height, best)) best = { width, height, rects };
  }
  return best;
}

/** Whether a `width` by `height` sheet beats `best`: smaller, then squarer. */
function better(width: number, height: number, best: AtlasLayout): boolean {
  const area = width * height;
  const bestArea = best.width * best.height;
  if (area !== bestArea) return area < bestArea;
  return Math.abs(width - height) < Math.abs(best.width - best.height);
}

/**
 * A tile's place in the sheet as a UV transform: `u + s * du` for a `s` that was
 * a coordinate into the tile on its own.
 *
 * `v` counts up from the bottom, because that is where a texture's own `v` zero
 * is once the webview has flipped it for OpenGL, while `rect.y` counts down from
 * the top the way a canvas does.
 */
export interface AtlasPlace {
  u: number;
  v: number;
  du: number;
  dv: number;
}

/** Where `rect` lands in a `width` by `height` sheet, in UV. */
export function atlasPlace(
  rect: AtlasRect,
  width: number,
  height: number,
): AtlasPlace {
  return {
    u: rect.x / width,
    v: (height - rect.y - rect.h) / height,
    du: rect.w / width,
    dv: rect.h / height,
  };
}

/** `uvs` rewritten from the tile's own coordinates into the sheet's. */
export function placeUvs(uvs: number[], place: AtlasPlace): number[] {
  const moved = new Array<number>(uvs.length);
  for (let i = 0; i < uvs.length; i += 2) {
    moved[i] = place.u + uvs[i] * place.du;
    moved[i + 1] = place.v + uvs[i + 1] * place.dv;
  }
  return moved;
}

/** What can be drawn into a canvas: a loaded image, or another canvas. */
export type AtlasSource = CanvasImageSource & { width: number; height: number };

/**
 * Draw the tiles into a sheet, each one ringed by a repeat of its own edge.
 *
 * The ring is nine draws rather than one: the tile, then its four edges stretched
 * outwards and its four corner pixels into the corners. Cheaper than growing the
 * image beforehand and it never touches the source.
 */
export function drawAtlas(
  sources: AtlasSource[],
  layout: AtlasLayout,
  padding = ATLAS_PADDING,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.imageSmoothingEnabled = false;

  layout.rects.forEach((rect, index) => {
    const source = sources[index];
    const { w, h } = rect;
    const p = padding;
    const put = (
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      context.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
    };
    // The tile.
    put(0, 0, source.width, source.height, rect.x, rect.y, w, h);
    // Its edges, one pixel of source stretched over the padding.
    put(0, 0, 1, source.height, rect.x - p, rect.y, p, h);
    put(source.width - 1, 0, 1, source.height, rect.x + w, rect.y, p, h);
    put(0, 0, source.width, 1, rect.x, rect.y - p, w, p);
    put(0, source.height - 1, source.width, 1, rect.x, rect.y + h, w, p);
    // Its corners.
    put(0, 0, 1, 1, rect.x - p, rect.y - p, p, p);
    put(source.width - 1, 0, 1, 1, rect.x + w, rect.y - p, p, p);
    put(0, source.height - 1, 1, 1, rect.x - p, rect.y + h, p, p);
    put(
      source.width - 1,
      source.height - 1,
      1,
      1,
      rect.x + w,
      rect.y + h,
      p,
      p,
    );
  });
  return canvas;
}
