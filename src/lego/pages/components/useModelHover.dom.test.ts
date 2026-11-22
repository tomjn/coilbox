// @vitest-environment happy-dom

/**
 * The 3D view's side of the hovered piece it shares with the sidebar tree
 * (#5417): a row hovered in the tree is drawn here, and a piece the pointer
 * already drew is not drawn a second time.
 */

import { act, renderHook } from "@testing-library/react";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { LegoProject } from "../../model";
import { createHoverStore } from "./hoverStore";
import type { SceneState } from "./sceneState";
import { useModelHover } from "./useModelHover";

const project = {
  pieces: [
    { id: "body", name: "body", parentId: null },
    { id: "arm", name: "arm", parentId: "body" },
    { id: "gun", name: "gun", parentId: "body", hidden: true },
  ],
} as unknown as LegoProject;

/** Enough of a scene for the hover outline and wash. Nothing here draws. */
function scene() {
  const groups = new Map<string, THREE.Group>();
  for (const id of ["body", "arm", "gun"]) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry()));
    groups.set(id, group);
  }
  const hoverOutline = new THREE.BoxHelper(new THREE.Group());
  hoverOutline.visible = false;
  const state = {
    groups,
    hoveredId: null,
    hoverOutline,
    hoverOverlay: new THREE.Mesh(new THREE.BufferGeometry()),
    hoverMark: new THREE.Object3D(),
    selectedIdsRef: { current: [] },
    render: vi.fn(),
  } as unknown as SceneState;
  return { state, ref: { current: state }, hoverOutline };
}

describe("useModelHover", () => {
  it("draws a piece hovered from the tree", () => {
    const { state, ref, hoverOutline } = scene();
    const hover = createHoverStore();
    renderHook(() => useModelHover(ref, hover, project));
    vi.mocked(state.render).mockClear();

    act(() => hover.set("arm"));
    expect(state.hoveredId).toBe("arm");
    expect(hoverOutline.visible).toBe(true);
    expect(state.render).toHaveBeenCalledTimes(1);

    act(() => hover.set(null));
    expect(state.hoveredId).toBeNull();
    expect(hoverOutline.visible).toBe(false);
  });

  it("does not draw again what the pointer already drew", () => {
    const { state, ref } = scene();
    const hover = createHoverStore();
    renderHook(() => useModelHover(ref, hover, project));
    vi.mocked(state.render).mockClear();

    // The pointer's own path stores the piece and draws it before it tells
    // the store.
    state.hoveredId = "arm";
    act(() => hover.set("arm"));
    expect(state.render).not.toHaveBeenCalled();
  });

  it("treats a hidden piece as nothing hovered", () => {
    const { state, ref } = scene();
    const hover = createHoverStore();
    renderHook(() => useModelHover(ref, hover, project));
    act(() => hover.set("gun"));
    expect(state.hoveredId).toBeNull();
  });

  it("redraws the hovered piece after an edit", () => {
    const { state, ref } = scene();
    const hover = createHoverStore();
    hover.set("arm");
    const { rerender } = renderHook(
      ({ unit }) => useModelHover(ref, hover, unit),
      { initialProps: { unit: project } },
    );
    vi.mocked(state.render).mockClear();
    rerender({ unit: { ...project } });
    expect(state.render).toHaveBeenCalledTimes(1);
    expect(state.hoveredId).toBe("arm");
  });
});
