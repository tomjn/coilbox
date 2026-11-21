// @vitest-environment happy-dom

/**
 * Reading textures reuses one WebGL context (issue #5351).
 *
 * Each read used to make a context of its own. WebKit still counts one after
 * `loseContext`, so a unit builder that read a few dozen textures ran the
 * browser out and another 3D view went blank.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readTexturePixels, releaseDecodingContext } from "./texturePixels";

/** One call per context the page was asked for. */
const contexts: ReturnType<typeof fakeGl>[] = [];

function fakeGl() {
  const gl = {
    lost: false,
    textures: 0,
    framebuffers: 0,
    TEXTURE_2D: 1,
    FRAMEBUFFER: 2,
    COLOR_ATTACHMENT0: 3,
    FRAMEBUFFER_COMPLETE: 4,
    RGBA: 5,
    UNSIGNED_BYTE: 6,
    NONE: 7,
    isContextLost: () => gl.lost,
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: () => 4,
    createTexture: () => {
      gl.textures++;
      return {};
    },
    deleteTexture: () => {
      gl.textures--;
    },
    createFramebuffer: () => {
      gl.framebuffers++;
      return {};
    },
    deleteFramebuffer: () => {
      gl.framebuffers--;
    },
    readPixels: (
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      _f: number,
      _t: number,
      data: Uint8ClampedArray,
    ) => {
      data.fill(255);
    },
    getExtension: vi.fn(),
  };
  return gl;
}

beforeEach(() => {
  releaseDecodingContext();
  contexts.length = 0;
  vi.stubGlobal("OffscreenCanvas", undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => {
      const gl = fakeGl();
      contexts.push(gl);
      return gl;
    }) as never,
  );
  // An image that has loaded by the time anyone listens.
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 4;
      naturalHeight = 4;
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  // `source instanceof HTMLImageElement` picks the size, so make ours one.
  vi.stubGlobal("HTMLImageElement", globalThis.Image);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("readTexturePixels", () => {
  it("makes one context however many textures are read", async () => {
    for (let i = 0; i < 40; i++) {
      const pixels = await readTexturePixels("texture.png");
      expect(pixels.width).toBe(4);
    }
    expect(contexts).toHaveLength(1);
  });

  it("never gives the context back, which would only make it count twice", async () => {
    await readTexturePixels("texture.png");
    expect(contexts[0].getExtension).not.toHaveBeenCalled();
  });

  it("frees the texture and framebuffer each read made", async () => {
    for (let i = 0; i < 5; i++) await readTexturePixels("texture.png");
    expect(contexts[0].textures).toBe(0);
    expect(contexts[0].framebuffers).toBe(0);
  });

  it("makes another context only when the browser has taken the first back", async () => {
    await readTexturePixels("texture.png");
    contexts[0].lost = true;
    await readTexturePixels("texture.png");
    expect(contexts).toHaveLength(2);
    await readTexturePixels("texture.png");
    expect(contexts).toHaveLength(2);
  });

  it("frees what a read that failed had made", async () => {
    await readTexturePixels("texture.png");
    contexts[0].texImage2D.mockImplementationOnce(() => {
      throw new Error("upload failed");
    });
    await expect(readTexturePixels("texture.png")).rejects.toThrow(
      "upload failed",
    );
    expect(contexts[0].textures).toBe(0);
    expect(contexts[0].framebuffers).toBe(0);
    await readTexturePixels("texture.png");
    expect(contexts).toHaveLength(1);
  });
});
