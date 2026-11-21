// @vitest-environment happy-dom

/**
 * Drawing candidate pictures reuses one renderer (issue #5351).
 *
 * Each call used to make a WebGL context of its own. WebKit still counts one
 * after `forceContextLoss`, so a generate screen rerolled again and again ran
 * the browser out and another 3D view went blank.
 */

import type * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.fn();
const lost = vi.fn();
const drawn = vi.fn();

vi.mock("three", async (orig) => {
  const actual = await orig<typeof import("three")>();
  class FakeRenderer {
    domElement = Object.assign(document.createElement("canvas"), {
      toDataURL: () => "data:image/png;base64,AAAA",
    });
    constructor() {
      made();
    }
    getContext() {
      return { isContextLost: () => false };
    }
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    render() {
      drawn();
    }
    dispose() {}
    forceContextLoss() {
      lost();
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import { releaseKeptRenderers } from "../lib/keptRenderer";
import { drawUnitPictures } from "./candidatePictures";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";

/** No pieces, so nothing is looked up in the pack: only the renderer is under test. */
const unit = { id: "u", pieces: [] } as unknown as LegoProject;
const pack = {} as LoadedPack;
const material = {} as THREE.Material;

beforeEach(() => {
  releaseKeptRenderers();
  made.mockClear();
  lost.mockClear();
  drawn.mockClear();
});

describe("drawUnitPictures", () => {
  it("makes one renderer however many batches are drawn", () => {
    for (let batch = 0; batch < 20; batch++) {
      expect(drawUnitPictures([unit, unit], pack, material)).toHaveLength(2);
    }
    expect(drawn).toHaveBeenCalledTimes(40);
    expect(made).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
  });

  it("makes none for an empty batch", () => {
    expect(drawUnitPictures([], pack, material)).toEqual([]);
    expect(made).not.toHaveBeenCalled();
  });

  it("keeps the renderer after a draw throws", () => {
    drawn.mockImplementationOnce(() => {
      throw new Error("draw failed");
    });
    expect(() => drawUnitPictures([unit], pack, material)).toThrow(
      "draw failed",
    );
    drawUnitPictures([unit], pack, material);
    expect(made).toHaveBeenCalledTimes(1);
  });
});
