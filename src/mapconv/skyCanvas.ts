import type { MapAppearance } from "./bindings";
import { generateSkyPanorama, skyInputs } from "./skyPanorama";

/** The preview draws the generated sky at half the size written into a map.
 * It is the same sky, and builds in about a third of the time. */
const PREVIEW_WIDTH = 1024;
const PREVIEW_HEIGHT = 512;
/** Skies kept, so moving between a few maps does not build each one again. */
const KEEP = 4;

const built = new Map<string, HTMLCanvasElement>();

/**
 * A canvas holding the generated sky for a map's colours, top row first. Kept
 * by those colours, because a preview is rebuilt on every toggle and the sky
 * only changes when they do.
 */
export function generatedSkyCanvas(
  app?: MapAppearance | null,
): HTMLCanvasElement {
  const key = JSON.stringify(skyInputs(app));
  const held = built.get(key);
  if (held) {
    built.delete(key);
    built.set(key, held);
    return held;
  }
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  canvas
    .getContext("2d")
    ?.putImageData(
      new ImageData(
        generateSkyPanorama(app, PREVIEW_WIDTH, PREVIEW_HEIGHT),
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT,
      ),
      0,
      0,
    );
  built.set(key, canvas);
  for (const old of built.keys()) {
    if (built.size <= KEEP) break;
    built.delete(old);
  }
  return canvas;
}
