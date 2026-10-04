import { useSetting } from "@picoframe/frame";
import { useEffect } from "react";
import { updateStoredSetting } from "../lib/storedSetting";
import {
  CONQUEST_UNLOCKS_KEY,
  type ConquestUnlocks,
  type FinishedConquest,
  foldFinishedConquest,
} from "./unlocks";

/**
 * The conquest unlock document, persisted through the frame's settings store
 * like the challenge records, under its own key.
 *
 * `award` folds over the stored value rather than the render's copy, so two
 * conquests finishing in one pass both land.
 */
export function useConquestUnlocks() {
  const [unlocks, setUnlocks] = useSetting<ConquestUnlocks>(
    CONQUEST_UNLOCKS_KEY,
    {},
  );

  /** Count a finished conquest. Counting the same one again changes nothing. */
  function award(finished: FinishedConquest) {
    updateStoredSetting(CONQUEST_UNLOCKS_KEY, {}, setUnlocks, (prev) =>
      foldFinishedConquest(prev, finished),
    );
  }

  return { unlocks, award };
}

/**
 * Count a finished conquest once. Pass null while it is still going. The run's
 * id stops a page opened again later counting it a second time.
 */
export function useAwardFinishedConquest(finished: FinishedConquest | null) {
  const { award } = useConquestUnlocks();
  const runId = finished?.runId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on which run finished, not on the object or `award`, which change every render
  useEffect(() => {
    if (finished) award(finished);
  }, [runId]);
}
