// @vitest-environment happy-dom

/**
 * A renderer made for one picture is kept for the next (issue #5351).
 *
 * WebKit still counts a context after `forceContextLoss`, so a view or a
 * picture that makes a new one each time it runs uses the browser's allowance up
 * and another 3D view goes blank. The count that matters is how many renderers
 * three was asked to make.
 */

import type * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.fn();
const lost = vi.fn();
/** Whether a browser has taken a context back, by the renderer's number. */
const taken = new Set<number>();
let count = 0;
vi.mock("three", () => ({
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    number = count++;
    constructor() {
      made();
    }
    getContext() {
      return { isContextLost: () => taken.has(this.number) };
    }
    dispose() {}
    forceContextLoss() {
      lost();
    }
  },
}));

import * as three from "three";
import {
  borrowRenderer,
  releaseKeptRenderers,
  returnRenderer,
} from "./keptRenderer";

const make = () => new three.WebGLRenderer() as THREE.WebGLRenderer;

beforeEach(() => {
  releaseKeptRenderers();
  taken.clear();
  count = 0;
  made.mockClear();
  lost.mockClear();
});

describe("borrowRenderer", () => {
  it("makes one renderer for any number of borrowers in turn", () => {
    for (let i = 0; i < 40; i++) {
      returnRenderer("pictures", borrowRenderer("pictures", make));
    }
    expect(made).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
  });

  it("gives two borrowers at once a renderer each", () => {
    const a = borrowRenderer("pictures", make);
    const b = borrowRenderer("pictures", make);
    expect(a).not.toBe(b);
    returnRenderer("pictures", a);
    returnRenderer("pictures", b);
    borrowRenderer("pictures", make);
    borrowRenderer("pictures", make);
    expect(made).toHaveBeenCalledTimes(2);
  });

  it("keeps renderers made differently apart", () => {
    returnRenderer("one", borrowRenderer("one", make));
    returnRenderer("two", borrowRenderer("two", make));
    expect(made).toHaveBeenCalledTimes(2);
    borrowRenderer("one", make);
    borrowRenderer("two", make);
    expect(made).toHaveBeenCalledTimes(2);
  });

  it("does not hand out a renderer the browser has taken back", () => {
    returnRenderer("pictures", borrowRenderer("pictures", make));
    taken.add(0);
    const next = borrowRenderer("pictures", make);
    expect(made).toHaveBeenCalledTimes(2);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(next.getContext().isContextLost()).toBe(false);
  });

  it("takes a returned renderer's canvas off the page", () => {
    const renderer = borrowRenderer("pictures", make);
    document.body.appendChild(renderer.domElement);
    returnRenderer("pictures", renderer);
    expect(document.body.contains(renderer.domElement)).toBe(false);
  });
});
