// @vitest-environment happy-dom

/**
 * Rendering units reuses one renderer (issue #5351).
 *
 * A backfill renders every building of every blueprint, and each render made a
 * WebGL context of its own. WebKit still counts one after the code gives it
 * back, so a long backfill ran the browser out and another 3D view went blank.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnitModelResult } from "@/content/bindings";

const made = vi.fn();
const lost = vi.fn();
const optionsSeen: unknown[] = [];

vi.mock("three", async (orig) => {
  const actual = await orig<typeof import("three")>();
  class FakeRenderer {
    domElement = document.createElement("canvas");
    constructor(options: unknown) {
      optionsSeen.push(options);
      made();
    }
    getContext() {
      return {
        isContextLost: () => false,
        readPixels: () => {},
        RGBA: 0,
        UNSIGNED_BYTE: 0,
      };
    }
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    render() {}
    dispose() {}
    forceContextLoss() {
      lost();
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import { releaseKeptRenderers } from "@/lib/keptRenderer";
import { renderUnit } from "./renderTop";

/** One triangle with no texture, so there is nothing to wait for. */
const model: UnitModelResult = {
  format: "s3o",
  path: "units/test.s3o",
  radius: 10,
  height: 10,
  mid: [0, 5, 0],
  textures: [],
  paletteFaces: 0,
  errors: [],
  root: {
    name: "base",
    offset: [0, 0, 0],
    children: [],
    groups: [
      {
        positions: [-8, 0, -8, 8, 0, -8, 0, 8, 8],
        normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
        uvs: [0, 0, 1, 0, 0.5, 1],
        indices: [0, 1, 2],
      },
    ],
  },
};

beforeEach(() => {
  releaseKeptRenderers();
  made.mockClear();
  lost.mockClear();
  optionsSeen.length = 0;
});

describe("renderUnit", () => {
  it("makes one renderer however many units are rendered", async () => {
    for (let i = 0; i < 20; i++) {
      const drawn = await renderUnit("front", model, 2, 2);
      expect(drawn.width).toBeGreaterThan(0);
    }
    expect(made).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
  });

  // The draw and the read-back follow the wait for textures without another
  // wait, so renders that overlap take the renderer one after the other.
  it("shares one renderer between renders that overlap", async () => {
    await Promise.all(
      Array.from({ length: 6 }, () => renderUnit("front", model, 2, 2)),
    );
    expect(made).toHaveBeenCalledTimes(1);
  });

  it("still asks for straight alpha, which the encoder expects", async () => {
    await renderUnit("front", model, 2, 2);
    expect(optionsSeen[0]).toMatchObject({
      alpha: true,
      premultipliedAlpha: false,
    });
  });
});
