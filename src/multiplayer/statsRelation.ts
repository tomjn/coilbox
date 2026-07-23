import { useMemo } from "react";
import {
  useContentState,
  useReplayStats,
  useScanTargetSelection,
} from "@/content/config";
import { type PlayerRelation, relationTo } from "@/content/stats";

/**
 * A compact per-player summary for the multiplayer user popover (#375): reuses
 * the local replay-stats database (#414) the Content > Stats page already
 * ingests, so the popover's "N games with this player" line needs no new data
 * path. `me` is the connected account's own username (`myUsername`); relations
 * read as empty until it's known. See `statsRelationSummary.ts` for the pure
 * formatter this feeds.
 */
export function useStatsRelations(
  me: string | null,
): (other: string) => PlayerRelation | null {
  const { state } = useContentState();
  const { selected } = useScanTargetSelection();
  const roots = useMemo(() => (state?.roots ?? []).map((r) => r.path), [state]);
  const { records } = useReplayStats(roots, selected?.enginePath);

  return useMemo(() => {
    return (other: string) => (me ? relationTo(records, me, other) : null);
  }, [records, me]);
}
