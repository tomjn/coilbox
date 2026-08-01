import { useCallback, useState } from "react";
import {
  contentDemoInfo,
  contentListReplays,
  type ReplayFile,
} from "../content/bindings";
import { primeScan, useUnitsyncScan } from "../content/config";
import { useReplayUserState } from "../content/replayUserState";
import type { BattleConfig } from "../play/bindings";
import type { PlayTarget } from "../play/config";
import { toBattleConfig, usePreferredTarget } from "../play/config";
import {
  type DetectedResult,
  diffNewReplays,
  pickNewestReplay,
  resultFromDemoInfo,
} from "../play/detect";
import { usePlay } from "../play/PlayProvider";
import { launchScenario } from "../scenario/launch";
import { useCampaignProgress } from "./campaigns";
import type { Campaign, CampaignMission } from "./model";
import { applyDefeat, applyVictory, nextAvailableMission } from "./results";
import { ensureCampaignScenarioMedia } from "./scenarioMedia";

/* -------------------------------------------------------------------------- *
 * The mission run hook — install check, launch, automatic result detection from
 * the replay, and the manual result flow as its fallback. Pure progress
 * transitions live in `results.ts`; the pure detection helpers (set-diff,
 * newest-pick, verdict) live in `detect.ts` so they're unit-testable without
 * mocking the Tauri commands used below.
 * -------------------------------------------------------------------------- */

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the content root for a replay that appeared after `beforePaths` was
 * snapshotted. A filesystem flush can lag briefly behind the engine exiting, so
 * an empty diff is retried a few times before giving up.
 */
async function findNewReplay(
  dataDir: string,
  beforePaths: ReadonlySet<string>,
): Promise<ReplayFile | null> {
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    const { replays } = await contentListReplays({ root: dataDir });
    const newest = pickNewestReplay(diffNewReplays(beforePaths, replays));
    if (newest) return newest;
    if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
  }
  return null;
}

/**
 * Detect the outcome of a just-finished mission launch: find the replay that
 * appeared since `beforePaths` was snapshotted (pre-launch), decode it, and read
 * off `playerName`'s result. Any failure along the way — no new replay, a decode
 * error, an unknown winner, or the player not being in the demo — resolves to
 * `"ambiguous"` rather than throwing, so the caller always falls back to the
 * manual prompt.
 */
async function detectMissionResult(opts: {
  target: PlayTarget;
  beforePaths: ReadonlySet<string>;
  playerName: string;
}): Promise<{ outcome: DetectedResult; replay: ReplayFile | null }> {
  const { target, beforePaths, playerName } = opts;
  try {
    const replay = await findNewReplay(target.dataDir, beforePaths);
    if (!replay) return { outcome: "ambiguous", replay: null };
    const { info } = await contentDemoInfo({
      enginePath: target.enginePath,
      replayPath: replay.path,
    });
    return { outcome: resultFromDemoInfo(info, playerName), replay };
  } catch {
    return { outcome: "ambiguous", replay: null };
  }
}

/**
 * The phases the briefing page moves through. Kept here (not a separate route) so
 * the launch promise and its `exitCode` stay in the component that awaits them;
 * the panorama background is continuous across all phases.
 *   briefing → (launch) → checking → result → victory | defeat
 *                              └───────────────↑ (auto-detected, skips `result`)
 * A cancelled launch (`exitCode === null`) returns to `briefing` with no prompt
 * and no detection attempt.
 */
export type MissionRunPhase =
  | "briefing"
  | "checking"
  | "result"
  | "victory"
  | "defeat";

/** What a mission needs installed before it can launch (exact-name match). */
export interface MissionRequirement {
  kind: "game" | "map";
  name: string;
}

/**
 * Drive one mission's play flow: resolve the launch target, check the mission's
 * game+map are installed, launch through {@link usePlay}, then determine the
 * outcome and persist progress. After a non-cancelled exit the new replay is
 * decoded (see `detect.ts`) to auto-resolve Victory/Defeat; when the replay
 * can't be found or its winner can't be read, the player is asked directly via
 * the manual Victory/Defeat prompt instead.
 *
 * A mission carrying a scenario goes through `launchScenario` instead of
 * building the config here, so there is one compile-write-validate path and the
 * campaign gets its refusals for free. Everything after the engine exits is the
 * same either way.
 */
export function useMissionRun(campaign: Campaign, mission: CampaignMission) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();
  const { progress, save } = useCampaignProgress();
  const { setProvenance } = useReplayUserState();

  const [phase, setPhase] = useState<MissionRunPhase>("briefing");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set only when the just-shown victory/defeat was auto-detected from the
  // replay, so the page can show a small "detected, not reported" note.
  const [autoDetected, setAutoDetected] = useState(false);

  const snapshot = mission.snapshot;
  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];
  const scanReady = !!scan.data;

  // Exact-name install check (no version substitution): the mission plays the
  // game+map it was authored against, or not at all.
  const missing: MissionRequirement | null = !scanReady
    ? null
    : !games.some((g) => g.name === snapshot.gameName)
      ? { kind: "game", name: snapshot.gameName }
      : !maps.some((m) => m.name === snapshot.mapName)
        ? { kind: "map", name: snapshot.mapName }
        : null;

  const noEngine = !targetLoading && !target;
  const scanLoading = !!target && !scanReady && scan.loading;
  const canStart =
    !!target && scanReady && !missing && !running && !scan.loading;

  /** Apply a Victory/Defeat progress transition and land on that phase — shared by
   * the manual buttons and automatic detection (`auto` just toggles the note). */
  const applyResult = useCallback(
    async (outcome: "victory" | "defeat", auto: boolean) => {
      setSaving(true);
      setError(null);
      try {
        const next =
          outcome === "victory"
            ? applyVictory(progress, campaign.id, mission.id)
            : applyDefeat(progress, campaign.id, mission.id);
        await save(next);
        setAutoDetected(auto);
        setPhase(outcome);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        // A save failure must not strand the player on "checking" (which has
        // no error display or retry) — fall back to the manual prompt, which
        // shows this error and offers Victory/Defeat again. A no-op when
        // already on "result" (the manual-button path).
        setPhase("result");
      } finally {
        setSaving(false);
      }
    },
    [save, progress, campaign.id, mission.id],
  );

  const start = useCallback(async () => {
    if (!target) return;
    const game = games.find((g) => g.name === snapshot.gameName);
    const map = maps.find((m) => m.name === snapshot.mapName);
    if (!game || !map) return;
    setError(null);
    // Snapshot the replay files that exist before the engine runs, so a diff
    // afterwards finds the one this launch just wrote. A failure here (content
    // root unreadable, say) just disables detection for this run — it never
    // blocks the launch itself.
    let beforePaths: Set<string> | null = null;
    try {
      const { replays } = await contentListReplays({ root: target.dataDir });
      beforePaths = new Set(replays.map((r) => r.path));
    } catch {
      beforePaths = null;
    }
    const startEngine = (config: BattleConfig) =>
      launch("campaign", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
    try {
      let exitCode: number | null;
      // The start script the engine was actually given. Detection reads the
      // local player's name off it, because that is the name the replay records
      // and there is more than one place a mission's could come from: a
      // scenario mission's config is built inside `launchScenario` from the
      // scenario's own setup, not from the snapshot read here.
      let launched: BattleConfig;
      if (mission.scenario) {
        // A bundled campaign's dialogue clips have never been written into the
        // media store, and that store is where the compile step copies them
        // from, so they are materialised here before anything is compiled.
        await ensureCampaignScenarioMedia(campaign.id);
        // A mission that carries a scenario is launched the one way a scenario
        // is ever launched: compiled, written where the game will look for it,
        // and read back before the engine is started. A refusal means nothing
        // ran, so it is shown and no result is looked for.
        const result = await launchScenario({
          scenario: mission.scenario,
          dataDir: target.dataDir,
          games,
          disabledUnits: mission.disabledUnits,
          rescan: async () =>
            (await primeScan(target.enginePath, target.dataDir, true)).games,
          launch: startEngine,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        launched = result.config;
        exitCode = result.exitCode;
      } else {
        // Build the engine config exactly as the skirmish launcher does, from
        // the snapshot's five draft fields, plus the mission's disabled-unit
        // list. The snapshot already holds only the options the author set, so
        // they pass straight through (see the run.ts note in the page).
        launched = toBattleConfig({
          participants: snapshot.participants,
          mapName: map.name,
          gameType: game.name,
          startPosType: snapshot.startPosType,
          modOptions: snapshot.modOptionValues,
          disabledUnits: mission.disabledUnits,
        });
        const res = await startEngine(launched);
        exitCode = res.exitCode;
      }
      // Cancelled before the game started: no outcome to report, no progress
      // written, no detection. Drop straight back to the briefing.
      if (exitCode === null) return;
      if (beforePaths === null) {
        setPhase("result");
        return;
      }
      setPhase("checking");
      // detectMissionResult already resolves internal failures to "ambiguous"
      // rather than throwing; this catch is a last-resort safety net so an
      // unexpected throw still falls through to the manual prompt instead of
      // stranding the player on the "checking" screen.
      const { outcome, replay } = await detectMissionResult({
        target,
        beforePaths,
        playerName: launched.myPlayerName,
      }).catch((): { outcome: DetectedResult; replay: null } => ({
        outcome: "ambiguous",
        replay: null,
      }));
      if (replay) {
        setProvenance(replay.filename, {
          mode: "campaign",
          campaignId: campaign.id,
          missionId: mission.id,
        });
      }
      if (outcome === "ambiguous") {
        setPhase("result");
      } else {
        await applyResult(outcome, true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [
    target,
    games,
    maps,
    snapshot,
    mission.disabledUnits,
    mission.scenario,
    launch,
    applyResult,
    campaign.id,
    mission.id,
    setProvenance,
  ]);

  const recordVictory = useCallback(
    () => applyResult("victory", false),
    [applyResult],
  );

  const recordDefeat = useCallback(
    () => applyResult("defeat", false),
    [applyResult],
  );

  /** Back to the briefing (for a retry after defeat, or to launch again). */
  const reset = useCallback(() => {
    setError(null);
    setAutoDetected(false);
    setPhase("briefing");
  }, []);

  // Computed from the (now-updated) progress after a win, so the victory screen's
  // Continue button points at the right next mission — or `null` when the
  // campaign is complete.
  const nextMission = nextAvailableMission(
    campaign,
    progress.campaigns[campaign.id],
    mission.id,
  );

  return {
    phase,
    error,
    canStart,
    missing,
    noEngine,
    scanLoading,
    running,
    saving,
    autoDetected,
    nextMission,
    start,
    recordVictory,
    recordDefeat,
    reset,
    /** Force a rescan so a just-installed game/map clears `missing` (install gate). */
    recheck: () => scan.run(true),
  };
}
