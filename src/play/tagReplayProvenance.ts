import { contentListReplays } from "../content/bindings";
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
 */
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function tagFreshReplay(
  dataDir: string,
  beforePaths: ReadonlySet<string>,
  provenance: ReplayProvenance,
  setProvenance: (filename: string, provenance: ReplayProvenance) => void,
): Promise<void> {
  try {
    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      const { replays } = await contentListReplays({ root: dataDir });
      const newest = pickNewestReplay(diffNewReplays(beforePaths, replays));
      if (newest) {
        setProvenance(newest.filename, provenance);
        return;
      }
      if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
    }
  } catch {
    // Best-effort — see the module doc.
  }
}
