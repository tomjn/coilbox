import { useSetting } from "@picoframe/frame";
import { useMemo } from "react";
import { useCampaignProgress, useCampaigns } from "../campaign/campaigns";
import { useConquestState, useGalaxies } from "../conquest/conquests";
import { listedHandmadeMaps } from "../conquest/handmade/conquest";
import { useHandmadeMaps } from "../conquest/handmade/useHandmadeMaps";
import { useConquestUnlocks } from "../conquest/useUnlocks";
import {
  type AchievementResult,
  evaluateAchievements,
} from "../content/achievements";
import {
  useContentState,
  useReplayStats,
  useScanTargetSelection,
  useUnitsyncScan,
} from "../content/config";
import {
  refightFilenames,
  scriptedModeFilenames,
  useReplayUserState,
} from "../content/replayUserState";
import { allPlayers, playerGameFacts } from "../content/stats";
import { useRunMeta } from "../runlite/runs";
import { buildCareer, type Career, type CareerInput } from "./career";

/** The places the page reads from. Each loads and fails on its own. */
export type SourceId = "campaigns" | "conquest" | "warpath" | "ai" | "games";

export interface SourceStatus {
  state: "loading" | "error" | "ready";
  /** Why it failed. */
  message?: string;
  /** What went wrong while it still has something to show. */
  warning?: string;
}

export interface CareerData {
  career: Career;
  /** Who "you" is: the Player stats pick, else the most-played name. Null with no records. */
  player: string | null;
  /** Every achievement for `player`, or null with no replay records to judge. */
  achievements: AchievementResult[] | null;
  sources: Record<SourceId, SourceStatus>;
}

const ready: SourceStatus = { state: "ready" };

/** Loading wins over an old error, because the load is a retry. */
export function settle(
  loading: boolean,
  ...errors: (string | null | undefined)[]
): SourceStatus {
  if (loading) return { state: "loading" };
  const message = errors.find((e): e is string => Boolean(e));
  return message ? { state: "error", message } : ready;
}

/**
 * Read every store the career page shows and fold them into one {@link Career}.
 *
 * A store with no answer yet, or a failed one, is passed to `buildCareer` as
 * `null` and reported in `sources`, so the page can say which part is missing
 * and show the rest. The installed games come from the content scan: when it
 * has no answer (`data` is null with an `error`) the games are grouped by name
 * only, and nothing is said about what is installed.
 */
export function useCareer(): CareerData {
  const campaigns = useCampaigns();
  const progress = useCampaignProgress();
  const galaxies = useGalaxies();
  const handmade = useHandmadeMaps();
  const conquestState = useConquestState();
  const { unlocks } = useConquestUnlocks();
  const meta = useRunMeta();

  const content = useContentState();
  const target = useScanTargetSelection();
  const roots = useMemo(
    () => (content.state?.roots ?? []).map((r) => r.path),
    [content.state],
  );
  const stats = useReplayStats(roots, target.selected?.enginePath);
  const { state: replayState } = useReplayUserState();
  const scan = useUnitsyncScan(
    target.selected?.enginePath,
    target.selected?.rootPath,
  );
  const [storedName] = useSetting("content.statsPlayer", "");

  const refights = useMemo(() => refightFilenames(replayState), [replayState]);
  const scripted = useMemo(
    () => scriptedModeFilenames(replayState),
    [replayState],
  );
  const player = useMemo(() => {
    const players = allPlayers(stats.records, refights);
    return players.find((p) => p.name === storedName)?.name ?? players[0]?.name;
  }, [stats.records, refights, storedName]);

  const campaignsStatus = settle(
    campaigns.loading || progress.loading,
    campaigns.error,
    progress.error,
  );
  const conquestStatus = settle(
    galaxies.loading || handmade.loading || conquestState.loading,
    galaxies.error,
    handmade.error,
    conquestState.error,
  );
  const warpathStatus = settle(meta.loading, meta.error);

  // The stats read ingests replays on open. A failed ingest still returns what
  // was stored, so records with an error is a stale answer, not no answer.
  const haveRecords = stats.records.length > 0;
  const aiStatus: SourceStatus = (() => {
    const base = settle(
      content.loading || (stats.ingesting && !haveRecords),
      content.error,
      haveRecords ? null : stats.error,
    );
    return base.state === "ready" && stats.error
      ? {
          ...base,
          warning: `Replay records could not be refreshed, so this may be out of date: ${stats.error}`,
        }
      : base;
  })();

  // Matching to installed games is a refinement. Without a target there is
  // nothing to scan, and that is not a failure.
  const scanPending =
    target.selected !== null &&
    scan.data === null &&
    !scan.error &&
    !scan.cancelled;
  const gamesStatus = settle(
    target.loading || scan.loading || scanPending,
    target.error,
    scan.error,
  );

  const campaignsReady = campaignsStatus.state === "ready";
  const conquestReady = conquestStatus.state === "ready";
  const warpathReady = warpathStatus.state === "ready";
  const aiReady = aiStatus.state === "ready";
  const installed = scan.data?.games ?? null;
  const career = useMemo(() => {
    const input: CareerInput = {
      installed,
      campaigns: campaignsReady
        ? { campaigns: campaigns.campaigns, progress: progress.progress }
        : null,
      conquest: conquestReady
        ? {
            galaxies: [
              ...galaxies.galaxies,
              ...listedHandmadeMaps(handmade.maps),
            ],
            state: conquestState.file,
            unlocks,
          }
        : null,
      ai:
        aiReady && player
          ? { records: stats.records, player, refights, scripted }
          : null,
      warpath: warpathReady ? meta.meta : null,
    };
    return buildCareer(input);
  }, [
    installed,
    campaignsReady,
    campaigns.campaigns,
    progress.progress,
    conquestReady,
    galaxies.galaxies,
    handmade.maps,
    conquestState.file,
    unlocks,
    aiReady,
    player,
    stats.records,
    refights,
    scripted,
    warpathReady,
    meta.meta,
  ]);

  // Achievements are the player's record across every game, so they are not
  // split by game. Null until the replay records answer, and when there are none.
  const achievements = useMemo(
    () =>
      aiReady && player
        ? evaluateAchievements(playerGameFacts(stats.records, player, refights))
        : null,
    [aiReady, player, stats.records, refights],
  );

  return {
    career,
    player: aiReady && player ? player : null,
    achievements,
    sources: {
      campaigns: campaignsStatus,
      conquest: conquestStatus,
      warpath: warpathStatus,
      ai: aiStatus,
      games: gamesStatus,
    },
  };
}
