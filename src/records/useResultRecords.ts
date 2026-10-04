import { useSetting } from "@picoframe/frame";
import { updateStoredSetting } from "../lib/storedSetting";
import {
  type GameResult,
  mergeResult,
  type ResultChange,
  type ResultRecord,
} from "./bestResult";

/**
 * Records of best results, one per identity (a key the caller derives from the
 * thing that was played), persisted through the frame settings store under
 * `storeKey`. Presets use it now, and a challenge code can use it with a key of
 * its own.
 *
 * Every write folds over the stored value rather than the render's copy, as
 * `useSkirmishPresets` does, so two games merged in one pass both land.
 */
export function useResultRecords(storeKey: string) {
  const [records, setRecords] = useSetting<Record<string, ResultRecord>>(
    storeKey,
    {},
  );

  const write = (
    change: (
      prev: Record<string, ResultRecord>,
    ) => Record<string, ResultRecord>,
  ) => updateStoredSetting(storeKey, {}, setRecords, change);

  /** Merge a finished game in, and say what it did to the record. */
  function record(identity: string, result: GameResult): ResultChange {
    let change = { kind: "duplicate" } as ResultChange;
    write((prev) => {
      const merged = mergeResult(prev[identity], result);
      change = merged.change;
      return merged.change.kind === "duplicate"
        ? prev
        : { ...prev, [identity]: merged.record };
    });
    return change;
  }

  /** Forget one record. */
  function clear(identity: string) {
    write((prev) => {
      if (!(identity in prev)) return prev;
      const { [identity]: _gone, ...rest } = prev;
      return rest;
    });
  }

  return { records, record, clear };
}
