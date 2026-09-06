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

import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

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
