import { useSetting } from "@picoframe/frame";

/**
 * Which mode produced a replay. Conquest/warpath/campaign tag it at the exact
 * moment they read back their fresh replay for result detection (see
 * `play/detect.ts` call sites in `conquest/run.ts`, `runlite/runlite-run.ts`
 * and `campaign/run.ts`); skirmish and multiplayer don't read a replay back
 * for anything, so they tag it best-effort right after their launch exits
 * (see `play/tagReplayProvenance.ts`, used by `SkirmishPage.tsx` and
 * `multiplayer/battle/useBattleLaunch.ts`).
 */
export type ReplayMode =
  | "conquest"
  | "warpath"
  | "campaign"
  | "skirmish"
  | "multiplayer"
  /**
   * A synthetic rerun of a decoded replay's setup (issue #368's "refight this
   * setup") — every seated player from the source replay refought as an AI.
   * Not a genuine match: #466 uses this marker to exclude refights from player
   * stats. Tagged the same best-effort way as skirmish/multiplayer, right
   * after the launch exits (see `tagFreshReplay`, called from `RefightPanel`).
   */
  | "refight";

/**
 * Where a replay came from: the mode plus enough ids to link back to the
 * originating node/run/mission. Absent entirely on replays predating this
 * feature, or when the best-effort tagging attempt found nothing.
 */
export interface ReplayProvenance {
  mode: ReplayMode;
  /** Conquest: the galaxy document id. */
  galaxyId?: string;
  /** Warpath: the run's opaque id in `RunStateFile.runs`. */
  runId?: string;
  /** Campaign: the campaign document id. */
  campaignId?: string;
  /** Conquest/warpath: the node id fought at. */
  nodeId?: string;
  /** Campaign: the mission id played. */
  missionId?: string;
  /** Refight: the filename of the replay the setup was refought from, so the
   * new replay's detail page can link back to it. */
  sourceReplayFilename?: string;
}

/**
 * Per-replay user state — a watched flag, free-form tags, and provenance —
 * persisted through the frame settings store (like the skirmish presets), keyed
 * by the replay's filename (stable within a content root, and available in the
 * cheap list summary where the demo's game-id isn't). Kept out of the Rust
 * store so it needs no new commands.
 */
export interface ReplayUserState {
  watched?: boolean;
  tags?: string[];
  provenance?: ReplayProvenance;
}

export function useReplayUserState() {
  const [state, setState] = useSetting<Record<string, ReplayUserState>>(
    "content.replayState",
    {},
  );

  const get = (key: string): ReplayUserState => state[key] ?? {};

  const setWatched = (key: string, watched: boolean) => {
    setState({ ...state, [key]: { ...state[key], watched } });
  };

  const setTags = (key: string, tags: string[]) => {
    setState({ ...state, [key]: { ...state[key], tags } });
  };

  /** Record where a replay came from — set once, when the mode first reads it
   * back for result detection. A no-op re-set (same filename fought twice
   * over, unlikely) just overwrites with the latest provenance. */
  const setProvenance = (key: string, provenance: ReplayProvenance) => {
    setState({ ...state, [key]: { ...state[key], provenance } });
  };

  /** Every tag in use, sorted, for the filter dropdown. */
  const allTags = (): string[] => {
    const set = new Set<string>();
    for (const s of Object.values(state)) {
      for (const t of s.tags ?? []) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  };

  return { state, get, setWatched, setTags, setProvenance, allTags };
}
