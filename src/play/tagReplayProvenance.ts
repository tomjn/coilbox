import { contentListReplays, type ReplayFile } from "../content/bindings";
import type { ReplayProvenance } from "../content/replayUserState";
import { diffNewReplays, pickNewestReplay } from "./detect";

/**
 * Best-effort provenance tagging for launches that don't otherwise read back
 * their replay (skirmish, multiplayer battles) — unlike conquest/warpath/
 * campaign, which tag it as a side effect of decoding the replay for result
 * detection (see their `run.ts`/`runlite-run.ts`), these just need the
 * filename. Mirrors the same poll-with-retry the strategic modes use for the
 * filesystem-flush lag, but never throws — a replay that can't be found or
 * listed just stays untagged rather than failing the launch it's called after.
 *
 * Returns the found replay (or null) so callers that also need it — e.g. the
 * skirmish debrief (#370), which decodes it for the outcome/duration — can
 * reuse this single lookup instead of re-deriving it.
 */
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function tagFreshReplay(
  dataDir: string,
  beforePaths: ReadonlySet<string>,
  provenance: ReplayProvenance,
  setProvenance: (filename: string, provenance: ReplayProvenance) => void,
): Promise<ReplayFile | null> {
  try {
    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      const { replays } = await contentListReplays({ root: dataDir });
      const newest = pickNewestReplay(diffNewReplays(beforePaths, replays));
      if (newest) {
        setProvenance(newest.filename, provenance);
        return newest;
      }
      if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
    }
  } catch {
    // Best-effort — see the module doc.
  }
  return null;
}
