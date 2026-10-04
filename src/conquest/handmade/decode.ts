import type { ProvincePixels } from "./trace";

/**
 * Decoding a map's images in the webview. Kept apart from `library.ts` so the
 * tests can replace it: there is no canvas outside a webview.
 */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // The `coilbox://` protocol answers with an open CORS header. Without
    // asking for it here the canvas below would refuse to hand back pixels.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not decode ${url}`));
    img.src = url;
  });
}

/** The size of an image in pixels. Rejects when it cannot be decoded. */
export async function imageSize(
  url: string,
): Promise<{ width: number; height: number }> {
  const img = await loadImage(url);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/** An image as RGBA pixels. Rejects when it cannot be decoded. */
export async function decodeRgba(url: string): Promise<ProvincePixels> {
  const img = await loadImage(url);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error(`could not decode ${url}`);
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}
