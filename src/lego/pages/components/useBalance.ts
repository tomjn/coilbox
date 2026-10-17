import { type RefObject, useEffect } from "react";
import type { BalanceResult } from "../../balance";
import { buildBalance, disposeBalance } from "./balanceLayer";
import type { SceneState } from "./sceneState";

/**
 * Draw the balance check on the ground while `show` is on. A result that is a
 * problem is drawn whatever `show` says, so a warning always has its picture.
 * A null result, which is what a script preview gives, draws nothing.
 */
export function useBalance(
  sceneRef: RefObject<SceneState | null>,
  { result, show }: { result: BalanceResult | null; show: boolean },
): void {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.balance) disposeBalance(state.balance);
    state.balance = null;
    if (result && (show || result.status === "outside")) {
      state.balance = buildBalance(result);
      if (state.balance) state.overlay.add(state.balance);
    }
    state.render();
  }, [sceneRef, result, show]);
}
