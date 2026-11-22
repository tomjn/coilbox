// @vitest-environment happy-dom

/**
 * A unit opens in four views when the viewport asks for them, once the unit has
 * been framed, and never again for the same scene (#5392).
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { showFourViews } from "./cameraFraming";
import type { SceneState } from "./sceneState";
import { useModelSceneSync } from "./useModelSceneSync";

const frame = vi.hoisted(() => ({ result: true }));

vi.mock("./cameraFraming", () => ({
  applySceneScale: vi.fn(),
  frameObject: vi.fn(() => frame.result),
  showFourViews: vi.fn(),
}));
vi.mock("./sceneState", () => ({ syncScene: vi.fn() }));
vi.mock("./bakedPlayback", () => ({ showBaked: vi.fn() }));

function mount(fourViewsFirst: boolean, state: SceneState) {
  return renderHook(
    ({ first, project }) =>
      useModelSceneSync(
        { current: state },
        {} as LoadedPack,
        null,
        project,
        false,
        false,
        first,
      ),
    { initialProps: { first: fourViewsFirst, project: {} as LegoProject } },
  );
}

function scene() {
  return { framed: false, root: {}, render: vi.fn() } as unknown as SceneState;
}

describe("useModelSceneSync", () => {
  beforeEach(() => {
    vi.mocked(showFourViews).mockClear();
    frame.result = true;
  });

  it("opens four views on the first frame when asked", () => {
    const state = scene();
    mount(true, state);
    expect(showFourViews).toHaveBeenCalledTimes(1);
    expect(showFourViews).toHaveBeenCalledWith(state, true, []);
  });

  it("leaves the one view alone when not asked", () => {
    mount(false, scene());
    expect(showFourViews).not.toHaveBeenCalled();
  });

  it("waits for geometry to frame before opening four views", () => {
    frame.result = false;
    const state = scene();
    const view = mount(true, state);
    expect(showFourViews).not.toHaveBeenCalled();
    frame.result = true;
    view.rerender({ first: true, project: {} as LegoProject });
    expect(showFourViews).toHaveBeenCalledTimes(1);
  });

  it("does not open four views again once the scene is framed", () => {
    const state = scene();
    const view = mount(true, state);
    view.rerender({ first: true, project: {} as LegoProject });
    view.rerender({ first: true, project: {} as LegoProject });
    expect(showFourViews).toHaveBeenCalledTimes(1);
  });
});
