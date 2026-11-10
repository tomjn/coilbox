// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { type BodyPlan, projectFromPlan } from "../../bodyPlans";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { SceneState } from "./sceneState";
import { useSkeleton } from "./useSkeleton";

const PLAN: BodyPlan = {
  id: "test.hook",
  label: "Hook",
  description: "A base and a body, for tests.",
  proportions: [],
  bones() {
    return [
      { id: "base", name: "base", parent: null, position: [0, 0, 0] },
      { id: "body", name: "body", parent: "base", position: [0, 10, 0] },
    ];
  },
  presets: [],
};

function unit(): LegoProject {
  let n = 0;
  return projectFromPlan(PLAN, {
    id: "u",
    rootPieceId: "root",
    name: "Unit",
    packId: "p",
    packVersion: "1",
    now: "2026-01-01T00:00:00.000Z",
    newId: () => `piece-${++n}`,
  });
}

function withoutSkeleton(): LegoProject {
  const { skeleton: _gone, ...plain } = unit();
  return {
    ...plain,
    pieces: plain.pieces.map(({ bone: _bone, ...rest }) => rest),
  };
}

/** A pack with no parts: the pieces that have geometry are shapes. */
const shapePack = {
  manifest: {} as LoadedPack["manifest"],
  library: { packs: [], atlases: [], dir: "", problems: [] },
  parts: [],
  byId: new Map(),
  vertices: new Float32Array(),
  indices: new Uint16Array(),
} as LoadedPack;

function setup(project: LegoProject, show: boolean) {
  const state = {
    skeleton: null,
    overlay: new THREE.Group(),
    renderer: { getPixelRatio: () => 1 },
    render: vi.fn(),
  } as unknown as SceneState;
  const props = { project, pack: shapePack, raw: null, show };
  const view = renderHook((p) => useSkeleton({ current: state }, p), {
    initialProps: props,
  });
  return { state, view, props };
}

describe("useSkeleton", () => {
  it("draws every piece as a dimmed joint for a unit with no skeleton", () => {
    const { state } = setup(withoutSkeleton(), true);

    expect(state.skeleton?.userData.labels).toBe("hover");
    expect(state.skeleton?.userData.joints).toHaveLength(2);
    expect(state.overlay.children).toContain(state.skeleton);
  });

  it("draws a bone to the far end of a piece's geometry, and none for an empty piece", () => {
    const plain = withoutSkeleton();
    const rod: LegoProject = {
      ...plain,
      pieces: [
        ...plain.pieces,
        {
          id: "rod",
          name: "rod",
          parentId: "root",
          partId: null,
          shape: { kind: "cylinder", size: [1, 3, 1], swatch: "grey" },
          position: [4, 2, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    };
    const { state } = setup(rod, true);
    const reach = state.skeleton?.children.find(
      (c) => c.userData.role === "reach",
    ) as THREE.LineSegments;
    const at = Array.from(reach.geometry.getAttribute("position").array);

    // Three empty pieces and the rod: one bone, from the rod's origin to the
    // top of its box, 1.5 above it.
    expect(at).toHaveLength(6);
    expect(at[0]).toBeCloseTo(4, 6);
    expect(at[1]).toBeCloseTo(2, 6);
    expect(at[4]).toBeCloseTo(3.5, 6);
  });

  it("draws a unit's own skeleton in full, with every label", () => {
    const { state } = setup(unit(), true);

    expect(state.skeleton?.userData.labels).toBeUndefined();
    expect(state.skeleton?.userData.joints).toHaveLength(2);
  });

  it("draws nothing while it is off, and frees the drawing when turned off", () => {
    const off = setup(withoutSkeleton(), false);
    expect(off.state.skeleton).toBeNull();
    expect(off.state.overlay.children).toHaveLength(0);

    const on = setup(withoutSkeleton(), true);
    on.view.rerender({ ...on.props, show: false });
    expect(on.state.skeleton).toBeNull();
    expect(on.state.overlay.children).toHaveLength(0);
  });
});
