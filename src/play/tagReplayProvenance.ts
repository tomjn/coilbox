import type { ReplayFile } from "../content/bindings";
import type { ReplayProvenance } from "../content/replayUserState";
import { findNewReplay } from "./detect";

/**
 * Best-effort provenance tagging for launches that don't otherwise read back
 * their replay (skirmish, multiplayer battles). Unlike conquest/warpath/
 * campaign, which tag it as a side effect of decoding the replay for result
 * detection (see their `run.ts`/`runlite-run.ts`), these just need the
 * filename. Uses the same poll-with-retry `findNewReplay` the strategic modes
 * use for the filesystem-flush lag, but never throws. A replay that can't be
 * found or listed just stays untagged rather than failing the launch it's
 * called after.
 *
 * Returns the found replay (or null) so callers that also need it, e.g. the
 * skirmish debrief (#370), which decodes it for the outcome/duration, can
 * reuse this single lookup instead of re-deriving it.
 */
export async function tagFreshReplay(
  dataDir: string,
  beforePaths: ReadonlySet<string>,
  provenance: ReplayProvenance,
  setProvenance: (filename: string, provenance: ReplayProvenance) => void,
): Promise<ReplayFile | null> {
  try {
    const replay = await findNewReplay(dataDir, beforePaths);
    if (replay) setProvenance(replay.filename, provenance);
    return replay;
  } catch {
    // Best-effort, see the module doc.
    return null;
  }
}
