import { type RefObject, useEffect } from "react";
import type { OverlapResult } from "../../overlap";
import { buildOverlap, disposeOverlap } from "./overlapLayer";
import type { SceneState } from "./sceneState";

/** Outline the buried pieces while `show` is on. */
export function useOverlap(
  sceneRef: RefObject<SceneState | null>,
  { result, show }: { result: OverlapResult | null; show: boolean },
): void {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.overlap) disposeOverlap(state.overlap);
    state.overlap = null;
    if (result && show) {
      state.overlap = buildOverlap(result);
      if (state.overlap) state.overlay.add(state.overlap);
    }
    state.render();
  }, [sceneRef, result, show]);
}
