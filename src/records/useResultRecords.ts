import { useSetting } from "@picoframe/frame";
import { updateStoredSetting } from "../lib/storedSetting";
import {
  type BestResult,
  type GameResult,
  mergeResult,
  presetRanking,
  type Ranking,
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
 *
 * Without a ranking, records rank skirmish games by their fastest win. A caller
 * with another measure passes its own `Ranking`.
 */
export function useResultRecords<
  R = GameResult,
  B = BestResult,
  C = ResultChange,
>(storeKey: string, ranking?: Ranking<R, B, C>) {
  const [records, setRecords] = useSetting<Record<string, ResultRecord<B>>>(
    storeKey,
    {},
  );

  const write = (
    change: (
      prev: Record<string, ResultRecord<B>>,
    ) => Record<string, ResultRecord<B>>,
  ) => updateStoredSetting(storeKey, {}, setRecords, change);

  /** Merge a finished game in, and say what it did to the record. */
  function record(identity: string, result: R): C | { kind: "duplicate" } {
    let change = { kind: "duplicate" } as C | { kind: "duplicate" };
    write((prev) => {
      const merged = mergeResult(
        prev[identity],
        result,
        ranking ?? (presetRanking as unknown as Ranking<R, B, C>),
      );
      change = merged.change;
      return (merged.change as { kind: string }).kind === "duplicate"
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
