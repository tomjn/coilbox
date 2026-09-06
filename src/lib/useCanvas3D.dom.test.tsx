// @vitest-environment happy-dom

/**
 * A torn-down canvas draws nothing (issue #1740).
 *
 * The hook tears its scene down in a layout effect, and a view that puts its own
 * content on that scene asks for a frame from a passive effect cleanup, which
 * React runs afterwards. Drawing that frame is what logs
 * `glTexStorage2D: Texture is immutable`, because three re-allocates storage for
 * a texture the disposed renderer still holds.
 *
 * The ordering is the whole point of the test, so it is React that runs it here
 * rather than the two cleanups being called by hand.
 */

import { render } from "@testing-library/react";
import { type RefObject, useEffect, useRef } from "react";
import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

/** Just the part of three the hook touches. */
const drawn = vi.fn();
/** One call per renderer three was asked to make. */
const made = vi.fn();
vi.mock("three", () => ({
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    constructor() {
      made();
    }
    setPixelRatio() {}
    setSize() {}
    dispose() {}
    render(...args: unknown[]) {
      drawn(...args);
    }
  },
}));

import { useCanvas3D } from "./useCanvas3D";

/** Never looked at, only counted: the hook is what is under test, not three. */
const scene = {} as THREE.Scene;
const camera = {} as THREE.Camera;

/** A view that hands its own `render` out, the way `GridScene` hands one to the
 *  layers that draw on it. */
function Viewport({ out }: { out: RefObject<(() => void) | null> }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useCanvas3D(
    hostRef,
    ({ renderer }) => {
      const render = () => renderer.render(scene, camera);
      out.current = render;
      return { render, resize: () => {}, dispose: () => {} };
    },
    [],
  );
  return (
    <div ref={hostRef}>
      <Layer out={out} />
    </div>
  );
}

/** A layer that redraws on the way out, so what it had drawn goes with it. */
function Layer({ out }: { out: RefObject<(() => void) | null> }) {
  useEffect(() => () => out.current?.(), [out]);
  return null;
}

function Harness() {
  const out = useRef<(() => void) | null>(null);
  return <Viewport out={out} />;
}

/** A view with nothing to draw yet, the way a map preview is before its
 *  sources have resolved. */
function Gated({ ready }: { ready: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useCanvas3D(
    hostRef,
    () => ({ render: () => {}, resize: () => {}, dispose: () => {} }),
    [],
    ready,
  );
  return <div ref={hostRef} />;
}

describe("useCanvas3D", () => {
  it("draws nothing once the canvas is gone", () => {
    const view = render(<Harness />);
    drawn.mockClear();
    view.unmount();
    expect(drawn).not.toHaveBeenCalled();
  });

  it("makes no renderer until there is something to build", () => {
    made.mockClear();
    const view = render(<Gated ready={false} />);
    expect(made).not.toHaveBeenCalled();
    view.rerender(<Gated ready={true} />);
    expect(made).toHaveBeenCalledTimes(1);
  });
});
