// @vitest-environment happy-dom

/**
 * The listeners `attachPointerHandlers` puts on the canvas, and whether the
 * dispose function it returns takes them all off again (issue #2544).
 *
 * The face-drag `pointerdown`/`pointermove`/`pointerup`/`pointercancel`
 * handlers were never in the set dispose removed, so every scene teardown
 * left four more listeners on the canvas holding a reference to the disposed
 * `SceneState`. None of the raycasting this file does needs exercising to
 * catch that: registering the handlers and then disposing them is enough to
 * see whether dispose removes what attach added.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { MeasureEnd } from "../../measure";
import { newMeasureScene } from "./measureLayer";
import { attachPointerHandlers } from "./pointerHandlers";
import type { SceneState } from "./sceneState";

/**
 * Only the fields `attachPointerHandlers` reads while registering: a canvas
 * to listen on, and a camera and root it closes over for the raycast a fired
 * event would run. Nothing here fires an event, so those two are never read.
 */
function state(domElement: HTMLElement): SceneState {
  return {
    renderer: { domElement } as unknown as THREE.WebGLRenderer,
    camera: {} as unknown as THREE.PerspectiveCamera,
    root: {} as unknown as THREE.Group,
  } as unknown as SceneState;
}

describe("attachPointerHandlers's dispose", () => {
  it("removes every listener it registered, not just some of them", () => {
    const canvas = document.createElement("canvas");
    const addSpy = vi.spyOn(canvas, "addEventListener");
    const removeSpy = vi.spyOn(canvas, "removeEventListener");

    const dispose = attachPointerHandlers(state(canvas));
    const added = addSpy.mock.calls.map(([type, listener]) => [type, listener]);
    expect(added.length).toBeGreaterThan(0);

    dispose();
    const removed = removeSpy.mock.calls.map(([type, listener]) => [
      type,
      listener,
    ]);

    expect(removed).toHaveLength(added.length);
    for (const call of added) {
      expect(removed).toContainEqual(call);
    }
  });
});

describe("a click on the ground while a path is being made", () => {
  /** A camera straight above the origin, looking down, so the middle of the
   *  canvas is the ground at the origin. */
  function looking(canvas: HTMLElement, pick: (at: [number, number]) => void) {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 100, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    return {
      renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer,
      camera,
      root: new THREE.Group(),
      gizmo: { dragging: false, axis: null },
      collisionDrag: null,
      collisionHandles: { visible: false, children: [] },
      packDrag: null,
      packHandles: { visible: false, children: [] },
      standIn: { visible: false },
      onStandInDragRef: { current: undefined },
      standInDrag: null,
      placingAnchorRef: { current: false },
      placingPartRef: { current: null },
      onPickGuideRef: { current: undefined },
      measure: { active: false, dragFrom: null, layer: null },
      onGroundPickRef: { current: pick },
      onSelectRef: { current: vi.fn() },
      groundShape: null,
      shaped: null,
    } as unknown as SceneState;
  }

  it("puts a point where it landed rather than clearing the selection", () => {
    const canvas = document.createElement("canvas");
    const pick = vi.fn();
    const scene = looking(canvas, pick);
    const dispose = attachPointerHandlers(scene);
    const at = { clientX: 50, clientY: 50, button: 0, pointerId: 1 };
    canvas.dispatchEvent(new PointerEvent("pointerdown", at));
    canvas.dispatchEvent(new PointerEvent("pointerup", at));
    dispose();

    expect(pick).toHaveBeenCalledTimes(1);
    const [[x, z]] = pick.mock.calls[0];
    expect(x).toBeCloseTo(0, 1);
    expect(z).toBeCloseTo(0, 1);
    expect(scene.onSelectRef.current).not.toHaveBeenCalled();
  });
});

describe("a click while a guide is being placed", () => {
  function above(canvas: HTMLElement, withModel: boolean) {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 100, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    const root = new THREE.Group();
    if (withModel) {
      const slab = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );
      slab.position.y = 3;
      root.add(slab);
    }
    root.updateMatrixWorld(true);
    const placed = vi.fn();
    return {
      placed,
      scene: {
        renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer,
        camera,
        root,
        gizmo: { dragging: false, axis: null },
        collisionDrag: null,
        collisionHandles: { visible: false, children: [] },
        packDrag: null,
        packHandles: { visible: false, children: [] },
        standIn: { visible: false },
        onStandInDragRef: { current: undefined },
        standInDrag: null,
        placingAnchorRef: { current: false },
        placingPartRef: { current: null },
        onPickGuideRef: { current: placed },
        measure: { active: false, dragFrom: null, layer: null },
        onGroundPickRef: { current: undefined },
        onSelectRef: { current: vi.fn() },
      } as unknown as SceneState,
    };
  }

  function click(canvas: HTMLElement) {
    const at = { clientX: 50, clientY: 50, button: 0, pointerId: 1 };
    canvas.dispatchEvent(new PointerEvent("pointerdown", at));
    canvas.dispatchEvent(new PointerEvent("pointerup", at));
  }

  it("hands over the point on the model and selects nothing", () => {
    const canvas = document.createElement("canvas");
    const { placed, scene } = above(canvas, true);
    const dispose = attachPointerHandlers(scene);
    click(canvas);
    dispose();

    const [[at]] = placed.mock.calls;
    expect(at[1]).toBeCloseTo(3);
    expect(scene.onSelectRef.current).not.toHaveBeenCalled();
  });

  it("hands over null for a click that missed, which is how it is cancelled", () => {
    const canvas = document.createElement("canvas");
    const { placed, scene } = above(canvas, false);
    const dispose = attachPointerHandlers(scene);
    click(canvas);
    dispose();

    expect(placed).toHaveBeenCalledWith(null);
  });
});

describe("a click while measuring", () => {
  function measuring(canvas: HTMLElement, snapping: boolean) {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 100, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    const root = new THREE.Group();
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    slab.position.y = 3;
    slab.userData.pieceId = "slab";
    root.add(slab);
    root.updateMatrixWorld(true);
    const picked = vi.fn();
    const moved = vi.fn();
    return {
      picked,
      moved,
      scene: {
        renderer: {
          domElement: canvas,
          getSize: (v: THREE.Vector2) => v.set(100, 100),
        } as unknown as THREE.WebGLRenderer,
        camera,
        root,
        gizmo: { dragging: false, axis: null },
        collisionDrag: null,
        collisionHandles: { visible: false, children: [] },
        packDrag: null,
        packHandles: { visible: false, children: [] },
        standIn: { visible: false },
        onStandInDragRef: { current: undefined },
        standInDrag: null,
        placingAnchorRef: { current: false },
        placingPartRef: { current: null },
        onPickGuideRef: { current: undefined },
        measure: {
          ...newMeasureScene(),
          active: true,
          onPick: picked,
          onMoveEnd: moved,
        },
        controls: { enabled: true },
        dragging: false,
        groups: new Map([["slab", slab]]),
        onGroundPickRef: { current: undefined },
        onSelectRef: { current: vi.fn() },
        snapping,
        projectRef: { current: { pieces: [] } },
        packRef: { current: {} },
        guidePlanes: [
          {
            id: "g",
            name: "y = 4",
            axis: "y",
            normal: [0, 1, 0],
            point: [0, 4, 0],
          },
        ],
        guideLines: [],
        groundShape: null,
        shaped: null,
      } as unknown as SceneState,
    };
  }

  function click(canvas: HTMLElement) {
    const at = { clientX: 50, clientY: 50, button: 0, pointerId: 1 };
    canvas.dispatchEvent(new PointerEvent("pointerdown", at));
    canvas.dispatchEvent(new PointerEvent("pointerup", at));
  }

  it("hands over the point on the model, snapped to a guide in reach, and selects nothing", () => {
    const canvas = document.createElement("canvas");
    const { picked, scene } = measuring(canvas, true);
    const dispose = attachPointerHandlers(scene);
    click(canvas);
    dispose();

    const end = picked.mock.calls[0][0] as MeasureEnd;
    expect(end.at[1]).toBeCloseTo(4);
    // A guide's point is a world point, not one on the piece under it.
    expect(end.on).toBeNull();
    expect(scene.onSelectRef.current).not.toHaveBeenCalled();
  });

  it("leaves the point where it landed while snapping is held off", () => {
    const canvas = document.createElement("canvas");
    const { picked, scene } = measuring(canvas, false);
    const dispose = attachPointerHandlers(scene);
    click(canvas);
    dispose();

    const end = picked.mock.calls[0][0] as MeasureEnd;
    expect(end.at[1]).toBeCloseTo(3);
    // Unsnapped on a piece, so held on that piece.
    expect(end.on?.pieceId).toBe("slab");
    expect(end.on?.local[1]).toBeCloseTo(0);
  });

  describe("on an end of a line already drawn", () => {
    /** One measurement from the middle of the canvas, on the slab at y 3,
     *  to a point off to the side. */
    function withLine(canvas: HTMLElement) {
      const made = measuring(canvas, false);
      const from: MeasureEnd = { at: [0, 3, 0], on: null };
      made.scene.measure.measurements = [
        { id: "m", from, to: { at: [4, 3, 0], on: null } },
      ];
      made.scene.measure.lines = {
        lines: [{ id: "m", from: [0, 3, 0], to: [4, 3, 0] }],
        pending: null,
      };
      return { ...made, from };
    }
    const press = { button: 0, pointerId: 1, clientY: 50 };
    function drag(canvas: HTMLElement, steps: number[]) {
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { ...press, clientX: 50 }),
      );
      for (const x of steps)
        canvas.dispatchEvent(
          new PointerEvent("pointermove", { ...press, clientX: x }),
        );
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { ...press, clientX: steps.at(-1) }),
      );
    }

    it("drags that end, snapped as a click is, and neither selects nor measures", () => {
      const canvas = document.createElement("canvas");
      const { picked, moved, scene } = withLine(canvas);
      const dispose = attachPointerHandlers(scene);
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { ...press, clientX: 50 }),
      );
      expect(scene.controls.enabled).toBe(false);
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { ...press, clientX: 52 }),
      );
      // Not yet past a click's travel.
      expect(moved).not.toHaveBeenCalled();
      // Past a click's travel and still over the slab, whose 5 elmos either
      // side of the middle are 4.5 pixels from this high up.
      const over = { ...press, clientX: 53, clientY: 53 };
      canvas.dispatchEvent(new PointerEvent("pointermove", over));
      canvas.dispatchEvent(new PointerEvent("pointerup", over));
      dispose();

      expect(moved).toHaveBeenCalledTimes(1);
      const [which, end] = moved.mock.calls[0] as [
        { id: string; end: string },
        MeasureEnd,
      ];
      expect(which).toEqual({ id: "m", end: "from" });
      expect(end.at[0]).toBeGreaterThan(0);
      expect(end.at[1]).toBeCloseTo(3);
      expect(end.on?.pieceId).toBe("slab");
      expect(picked).not.toHaveBeenCalled();
      expect(scene.onSelectRef.current).not.toHaveBeenCalled();
      expect(scene.controls.enabled).toBe(true);
      expect(scene.dragging).toBe(false);
    });

    it("measures from that end when it is clicked without moving", () => {
      const canvas = document.createElement("canvas");
      const { picked, moved, scene, from } = withLine(canvas);
      const dispose = attachPointerHandlers(scene);
      click(canvas);
      dispose();

      expect(picked).toHaveBeenCalledWith(from);
      expect(moved).not.toHaveBeenCalled();
    });

    it("leaves the press to the gizmo when a handle has it", () => {
      const canvas = document.createElement("canvas");
      const { moved, scene } = withLine(canvas);
      (scene.gizmo as { axis: string | null }).axis = "X";
      const dispose = attachPointerHandlers(scene);
      drag(canvas, [60]);
      dispose();

      expect(moved).not.toHaveBeenCalled();
      expect(scene.controls.enabled).toBe(true);
    });
  });
});
