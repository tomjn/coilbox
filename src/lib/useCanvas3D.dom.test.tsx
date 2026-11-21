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
/** One call per context given back to the browser. */
const lost = vi.fn();
vi.mock("three", () => ({
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    constructor() {
      made();
    }
    setPixelRatio() {}
    setSize() {}
    dispose() {}
    forceContextLoss() {
      lost();
    }
    clear() {}
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

/** One call per scene a view built, and one per scene it let go. */
const built = vi.fn();
const disposed = vi.fn();
/** The render each build handed out, oldest first, each drawing its own scene. */
const renders: (() => void)[] = [];

/** A view rebuilt whenever `n` changes, the way a preview follows a choice. */
function Counted({ n }: { n: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useCanvas3D(
    hostRef,
    ({ renderer }) => {
      built();
      const own = {} as THREE.Scene;
      const render = () => renderer.render(own, camera);
      renders.push(render);
      return {
        render,
        resize: () => {},
        dispose: disposed,
      };
    },
    [n],
  );
  return <div ref={hostRef} />;
}

/** A view that has nothing to draw while `shown` is false, the way a map
 *  preview does between one set of sources and the next. */
function Sometimes({ shown }: { shown: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useCanvas3D(
    hostRef,
    () =>
      shown
        ? { render: () => {}, resize: () => {}, dispose: () => {} }
        : undefined,
    [shown],
  );
  return <div ref={hostRef} />;
}

/** A view whose build finds nothing to draw. */
function Empty() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useCanvas3D(hostRef, () => undefined, []);
  return <div ref={hostRef} />;
}

describe("useCanvas3D", () => {
  it("draws nothing once the canvas is gone", () => {
    const view = render(<Harness />);
    drawn.mockClear();
    view.unmount();
    expect(drawn).not.toHaveBeenCalled();
  });

  // A browser keeps a few live WebGL contexts and drops the oldest past that
  // (issue #5344). `dispose()` frees three's buffers but leaves the context
  // alive until the garbage collector reaches it, so a view rebuilt on every
  // click starved the main model view of its own.
  it("gives its context back when the view unmounts", () => {
    const view = render(<Harness />);
    lost.mockClear();
    view.unmount();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  // WebKit still counts a context after `forceContextLoss`, so giving each one
  // back is not enough: a view that makes a new one for every change runs the
  // browser out and another view goes blank (issues #5344, #5348). The canvas
  // stays and only the scene on it is rebuilt.
  it("keeps one renderer when what the view shows changes", () => {
    made.mockClear();
    lost.mockClear();
    built.mockClear();
    disposed.mockClear();
    const view = render(<Counted n={0} />);
    for (let n = 1; n <= 20; n++) view.rerender(<Counted n={n} />);
    expect(made).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
    expect(built).toHaveBeenCalledTimes(21);
    expect(disposed).toHaveBeenCalledTimes(20);
    expect(view.container.querySelectorAll("canvas")).toHaveLength(1);
    view.unmount();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(disposed).toHaveBeenCalledTimes(21);
  });

  it("keeps its renderer through a build that has nothing to draw", () => {
    made.mockClear();
    lost.mockClear();
    const view = render(<Sometimes shown={true} />);
    view.rerender(<Sometimes shown={false} />);
    view.rerender(<Sometimes shown={true} />);
    expect(made).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
    view.unmount();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("gives back the context of a view that never had anything to draw", () => {
    lost.mockClear();
    const view = render(<Empty />);
    view.unmount();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  // The renderer outlives the scene, so the guard against a late frame has to
  // be about the scene (issue #1740): a layer that redraws as it goes asks the
  // scene it was on, after that scene's textures are freed.
  it("draws nothing for a scene that has been let go", () => {
    renders.length = 0;
    const view = render(<Counted n={0} />);
    const [old] = renders;
    old();
    view.rerender(<Counted n={1} />);
    drawn.mockClear();
    old();
    expect(drawn).not.toHaveBeenCalled();
    renders[1]();
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it("draws again when the browser restores a lost context", () => {
    const view = render(<Harness />);
    const canvas = view.container.querySelector("canvas");
    if (!canvas) throw new Error("no canvas was added to the host");
    drawn.mockClear();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(drawn).toHaveBeenCalledTimes(1);
    view.unmount();
    drawn.mockClear();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
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
