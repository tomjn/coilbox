import { t } from "@lingui/core/macro";
import { canvasPng } from "./mapImage";
import {
  type MatchStatsImage,
  type MatchStatsImageInput,
  matchStatsImage,
} from "./matchStatsImage";

/** The PNG is drawn at this multiple of the SVG's size, so text stays sharp when
 * the picture is zoomed. */
const SCALE = 2;

/**
 * Decode the SVG through an `Image`. A `data:` URL and not a blob URL, because
 * WebKit is stricter about what a blob URL may be drawn onto a canvas. The SVG
 * has no `foreignObject` and no external reference, so the canvas stays clean
 * and `toBlob` can read it.
 */
function loadSvg({ svg, width, height }: MatchStatsImage) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(width, height);
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(t`The chart could not be drawn as a picture.`));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * The chart as PNG bytes. Text is measured on the canvas that draws it, with the
 * same system font stack the SVG names, so wrapped lines fit the picture.
 */
export async function renderMatchStatsImage(
  input: MatchStatsImageInput,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  const measuring = canvas.getContext("2d");
  if (!measuring) throw new Error(t`A 2D canvas is not available.`);
  const picture = matchStatsImage(input, (text, font) => {
    measuring.font = font;
    return measuring.measureText(text).width;
  });
  const image = await loadSvg(picture);
  // Setting the size clears the context, so the drawing gets a fresh one.
  canvas.width = picture.width * SCALE;
  canvas.height = picture.height * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t`A 2D canvas is not available.`);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasPng(canvas);
}
