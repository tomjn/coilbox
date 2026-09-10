/**
 * Raw, unpremultiplied RGBA pixels of an image URL, decoded through WebGL.
 *
 * A 2D canvas's `getImageData` reads back *premultiplied* alpha: on most
 * implementations the browser multiplies RGB by alpha somewhere in the
 * decode-then-composite path, so an alpha-0 pixel comes back as rgb 0
 * whatever colour the file actually stored there. Spring's team-colour mask
 * is alpha-0 over most of a texture and carries the unit's real colour
 * underneath it (see `textureTeamColour.ts`), so that path silently turns
 * 96% of a typical texture black before any mixing runs.
 *
 * WebGL can be told, on both the upload and the read, not to premultiply:
 * `UNPACK_PREMULTIPLY_ALPHA_WEBGL` false on the way in, and a context created
 * with `premultipliedAlpha: false` on the way out, so `readPixels` hands back
 * exactly the bytes the file stored.
 */

/** What `readTexturePixels` hands back: one RGBA byte per channel per pixel,
 *  row major from the top left. */
export interface TexturePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Decode `url` to a source WebGL can upload from, preferring an `<img>`
 * element, which is what three.js's `TextureLoader` uploads and why the 3D
 * viewport shows a texture's colour under its mask. WebGL has to hand over an
 * image element's pixels unpremultiplied when asked. The webview coilbox runs
 * in ignores `premultiplyAlpha: "none"` on `createImageBitmap`, so a bitmap
 * comes back black wherever alpha is 0, which is why it is only the fallback.
 */
async function loadImageSource(
  url: string,
): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${url}`));
      image.src = url;
    });
  } catch {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await createImageBitmap(await response.blob(), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  }
}

/** The pixel size of whichever source `loadImageSource` returned. */
function sourceSize(source: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

/** A canvas that is never attached to the document, purely as a WebGL host. */
function detachedCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Read `source` back as unpremultiplied RGBA, via an offscreen WebGL context
 * that exists only for this one upload and read.
 */
function readPixelsFromSource(
  source: TexImageSource,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const canvas = detachedCanvas(width, height);
  const gl = canvas.getContext("webgl", {
    premultipliedAlpha: false,
  }) as WebGLRenderingContext | null;
  if (!gl) throw new Error("WebGL is not available to decode this texture.");

  try {
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("This texture's framebuffer never became complete.");
    }

    const data = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  } finally {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/**
 * The unpremultiplied RGBA pixels of the image at `url`.
 *
 * Used by the unit builder's texture preview, and by the GLB bake, both of
 * which need the file's own colour under a mask the browser would otherwise
 * multiply away.
 */
export async function readTexturePixels(url: string): Promise<TexturePixels> {
  const source = await loadImageSource(url);
  const { width, height } = sourceSize(source);
  try {
    const data = readPixelsFromSource(source, width, height);
    return { width, height, data };
  } finally {
    if (source instanceof ImageBitmap) source.close();
  }
}
