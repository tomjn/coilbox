import { emit } from "@tauri-apps/api/event";
import {
  contentStatsIngest,
  type ReplayFile,
  STATS_UPDATED_EVENT,
} from "../content/bindings";

/** Replays already ingested (or being ingested) this session, by path. */
const seen = new Set<string>();

/** Clear the session memory. For tests. */
export function forgetIngestedReplays(): void {
  seen.clear();
}

/**
 * Put a just-finished game's replay in the stats store, so the skirmish
 * setup's AI bonus suggestion, the Against AI section and the career page see
 * it without a stats page having been opened. The ingest command works per
 * content root and skips files it already holds, so one new replay costs one
 * decode. The command does not emit `STATS_UPDATED_EVENT` (only the live
 * watcher does, on the Rust side), so this emits it, and only when the pass
 * changed the store.
 *
 * Call it after the caller has what it needs from the replay. It never throws.
 * A failure leaves the replay for the next stats page open to pick up.
 */
export async function ingestFinishedReplay(
  target: { dataDir: string; enginePath: string },
  replay: ReplayFile | null,
): Promise<void> {
  if (!replay || seen.has(replay.path)) return;
  seen.add(replay.path);
  try {
    const { summary } = await contentStatsIngest({
      roots: [target.dataDir],
      enginePath: target.enginePath,
    });
    if (summary.added + summary.updated > 0) {
      await emit(STATS_UPDATED_EVENT, summary);
    }
  } catch {
    seen.delete(replay.path);
  }
}
