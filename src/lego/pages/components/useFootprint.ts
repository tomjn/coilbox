import { type RefObject, useEffect } from "react";
import type { FootprintResult } from "../../footprint";
import { buildFootprint, disposeFootprint } from "./footprintLayer";
import type { SceneState } from "./sceneState";

/**
 * Draw the footprint check on the ground while `show` is on. A unit that
 * sticks out of its footprint or differs from the one last written is drawn
 * whatever `show` says, so the message always has its picture.
 */
export function useFootprint(
  sceneRef: RefObject<SceneState | null>,
  { result, show }: { result: FootprintResult | null; show: boolean },
): void {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.footprint) disposeFootprint(state.footprint);
    state.footprint = null;
    const flagged =
      result?.status === "ok" &&
      (result.differs || result.overhang.x > 0 || result.overhang.z > 0);
    if (result && (show || flagged)) {
      state.footprint = buildFootprint(result);
      if (state.footprint) state.overlay.add(state.footprint);
    }
    state.render();
  }, [sceneRef, result, show]);
}
