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

function setup(project: LegoProject, show: boolean) {
  const state = {
    skeleton: null,
    overlay: new THREE.Group(),
    renderer: { getPixelRatio: () => 1 },
    render: vi.fn(),
  } as unknown as SceneState;
  const props = { project, pack: {} as LoadedPack, raw: null, show };
  const view = renderHook((p) => useSkeleton({ current: state }, p), {
    initialProps: props,
  });
  return { state, view, props };
}

describe("useSkeleton", () => {
  it("draws the geometry skeleton, dimmed, for a unit with no skeleton", () => {
    const { state } = setup(withoutSkeleton(), true);

    expect(state.skeleton?.userData.labels).toBe("hover");
    expect(state.skeleton?.userData.joints).toHaveLength(2);
    expect(state.overlay.children).toContain(state.skeleton);
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
