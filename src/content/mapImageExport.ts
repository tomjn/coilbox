import { drawHeatField } from "@/lib/heatCanvas";
import type { HeatField } from "@/lib/heatField";
import { legoSaveGlb } from "../lego/bindings";
import {
  canvasPng,
  drawMapImage,
  type ImageWords,
  imageBlocks,
  layoutImage,
  loadMinimap,
  type MarkPlace,
  mapPixelSize,
} from "./mapImage";

/**
 * The longer side of the map in the image when the map has no minimap to take a
 * size from. The size the app renders a minimap at, `1024 >> mip` with mip 0.
 */
const NO_MINIMAP_SIDE = 1024;

export interface MapImageInput {
  /** The page's minimap URL, or undefined for a map without one. */
  minimapUrl: string | undefined;
  world: { worldWidth: number; worldHeight: number };
  field: HeatField;
  words: ImageWords;
  /** One white dot a start, and one numbered circle a start position. */
  dots: readonly MarkPlace[];
  places: readonly MarkPlace[];
}

/**
 * The picture as PNG bytes. The map is drawn on a canvas made here and never
 * attached to the page, from a bitmap this function reads itself, so the canvas
 * is not tainted and `toBlob` can read it.
 */
export async function renderMapImage(
  input: MapImageInput,
): Promise<Uint8Array> {
  const minimap = input.minimapUrl ? await loadMinimap(input.minimapUrl) : null;
  try {
    const size = mapPixelSize(
      input.world,
      minimap ?? { width: NO_MINIMAP_SIDE, height: NO_MINIMAP_SIDE },
    );
    const canvas = document.createElement("canvas");
    const first = canvas.getContext("2d");
    if (!first) throw new Error("A 2D canvas is not available.");
    const layout = layoutImage(size, imageBlocks(input.words), (text, font) => {
      first.font = font;
      return first.measureText(text).width;
    });
    // Setting the size clears the context, so the drawing gets a fresh one.
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("A 2D canvas is not available.");

    const fieldCanvas = document.createElement("canvas");
    drawHeatField(fieldCanvas, input.field);
    drawMapImage(ctx, layout, {
      minimap,
      field: fieldCanvas,
      dots: input.dots,
      places: input.places,
    });
    return await canvasPng(canvas);
  } finally {
    minimap?.close();
  }
}

/**
 * Write PNG bytes to an absolute path. There is no command for images. This is
 * the unit builder's "save these bytes here", which checks the path is absolute
 * and writes it, whatever the file is, and the main window may call it.
 */
export async function savePngBytes(path: string, bytes: Uint8Array) {
  await legoSaveGlb({ path, bytes: Array.from(bytes) });
}
