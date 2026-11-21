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
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Just the part of three the hook touches. */
const drawn = vi.fn();
/** One call per renderer three was asked to make. */
const made = vi.fn();
/** One call per context given back to the browser. */
const lost = vi.fn();
/** Whether a browser has taken a context back, by the renderer's number. */
const taken = new Set<number>();
let count = 0;
vi.mock("three", () => ({
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    number = count++;
    localClippingEnabled = false;
    constructor() {
      made();
    }
    getContext() {
      return { isContextLost: () => taken.has(this.number) };
    }
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
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

import { releaseParkedRenderers, useCanvas3D } from "./useCanvas3D";

beforeEach(() => {
  releaseParkedRenderers();
  taken.clear();
  count = 0;
  made.mockClear();
  lost.mockClear();
  drawn.mockClear();
});

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
  // (issue #5344), and WebKit still counts one after `forceContextLoss`, so
  // giving each one back is not enough: a view mounted again and again ran the
  // browser out and another view went blank (issue #5348). The renderer is
  // parked when the view goes and the next view takes it.
  it("hands a view's renderer to the next view that mounts", () => {
    const first = render(<Harness />);
    first.unmount();
    expect(made).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) render(<Harness />).unmount();
    expect(made).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
    const view = render(<Harness />);
    expect(view.container.querySelectorAll("canvas")).toHaveLength(1);
    releaseParkedRenderers();
    expect(lost).not.toHaveBeenCalled();
    view.unmount();
    releaseParkedRenderers();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("makes a renderer for each view that is on screen at once", () => {
    const a = render(<Harness />);
    const b = render(<Harness />);
    expect(made).toHaveBeenCalledTimes(2);
    a.unmount();
    b.unmount();
    render(<Harness />).unmount();
    render(<Harness />).unmount();
    expect(made).toHaveBeenCalledTimes(2);
  });

  it("does not take a renderer back that the browser has lost", () => {
    render(<Harness />).unmount();
    taken.add(0);
    render(<Harness />).unmount();
    expect(made).toHaveBeenCalledTimes(2);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("draws nothing for a view that has gone, on a renderer another view has", () => {
    renders.length = 0;
    const gone = render(<Counted n={0} />);
    renders[0]();
    gone.unmount();
    const next = render(<Counted n={1} />);
    drawn.mockClear();
    renders[0]();
    expect(drawn).not.toHaveBeenCalled();
    renders[1]();
    expect(drawn).toHaveBeenCalledTimes(1);
    next.unmount();
  });

  // WebKit counts a context after it is given back, so a view that makes a new
  // one for every change runs the browser out too (issues #5344, #5348). The
  // canvas stays and only the scene on it is rebuilt.
  it("keeps one renderer when what the view shows changes", () => {
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
    expect(disposed).toHaveBeenCalledTimes(21);
    expect(view.container.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("keeps its renderer through a build that has nothing to draw", () => {
    const view = render(<Sometimes shown={true} />);
    view.rerender(<Sometimes shown={false} />);
    view.rerender(<Sometimes shown={true} />);
    expect(made).toHaveBeenCalledTimes(1);
    expect(lost).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps the renderer of a view that never had anything to draw", () => {
    render(<Empty />).unmount();
    render(<Empty />).unmount();
    expect(made).toHaveBeenCalledTimes(1);
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
    const view = render(<Gated ready={false} />);
    expect(made).not.toHaveBeenCalled();
    view.rerender(<Gated ready={true} />);
    expect(made).toHaveBeenCalledTimes(1);
  });
});
