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
import {
  gameOptionSchema,
  mapOptionSchema,
  toBattleConfig,
  usePreferredTarget,
} from "../play/config";
import {
  type DetectedResult,
  diffNewReplays,
  engineFailureMessage,
  pickNewestReplay,
  resultFromDemoInfo,
} from "../play/detect";
import { usePlay } from "../play/PlayProvider";
import { launchScenario } from "../scenario/launch";
import { type Difficulty, usesDifficulty } from "../scenario/model";
import { useCampaignProgress } from "./campaigns";
import type { Campaign, CampaignMission } from "./model";
import {
  applyDefeat,
  applyVictory,
  chooseDifficulty,
  nextAvailableMission,
  runDifficulty,
} from "./results";
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
 * Why a mission cannot be played whatever is installed, or null when its
 * snapshot names both a game and a map (issue #2245).
 *
 * The preset picker offers a preset reading "No game · No map" as readily as a
 * complete one, so an author can leave a mission short of either. That is not a
 * missing install and no download fixes it, which is the distinction the install
 * check below cannot make on its own: nothing is installed under the empty name,
 * so an exact-name match reads an unnamed map as one the machine does not have.
 *
 * The sentence is the campaign list's, from `campaignUnplayableReason` in
 * `listing.ts`, including numbering the mission from one. The list already says
 * "Mission 3 has no map" about this mission and the two must not contradict each
 * other, so `missionGate.test.tsx` pins them together.
 */
export function missionUnfinishedReason(
  campaign: Campaign,
  mission: CampaignMission,
): string | null {
  const short = [
    !mission.snapshot?.gameName && "game",
    !mission.snapshot?.mapName && "map",
  ].filter(Boolean);
  if (short.length === 0) return null;
  const at = campaign.missions.findIndex((m) => m.id === mission.id);
  return `Mission ${at + 1} has no ${short.join(" or ")}`;
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

  // A mission short of a name is answered before anything is looked for, so the
  // install check below only ever runs on a name worth looking for.
  const unfinished = missionUnfinishedReason(campaign, mission);

  // Exact-name install check (no version substitution): the mission plays the
  // game+map it was authored against, or not at all.
  const missing: MissionRequirement | null =
    unfinished || !scanReady
      ? null
      : !games.some((g) => g.name === snapshot.gameName)
        ? { kind: "game", name: snapshot.gameName }
        : !maps.some((m) => m.name === snapshot.mapName)
          ? { kind: "map", name: snapshot.mapName }
          : null;

  // How hard to play it (issue #2220). The level is the run's, held in progress
  // so it carries from one mission to the next, and offered only on a mission
  // whose scenario actually varies by it: a picker that changes nothing about
  // the mission in front of the player is a picker worth leaving out.
  const variesByDifficulty =
    !!mission.scenario && usesDifficulty(mission.scenario);
  const difficulty = runDifficulty(progress, campaign.id);

  const noEngine = !targetLoading && !target;
  const scanLoading = !!target && !scanReady && scan.loading;
  const canStart =
    !!target &&
    scanReady &&
    !unfinished &&
    !missing &&
    !running &&
    !scan.loading;

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
    // Read once for both branches. A scenario mission runs as a mutator over
    // this game, so the mutator's options are this game's options.
    const optionSchema = await gameOptionSchema(
      target,
      game.primaryArchive.name,
    );
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
          // Whoever is playing a campaign is a player, whether or not they also
          // wrote it: a refusal here is read on the briefing screen.
          reader: "player",
          dataDir: target.dataDir,
          games,
          optionSchema,
          // A scenario mission is set on its own map, which is the snapshot's
          // for every mission built from one but is the scenario's to say.
          mapOptionSchema: await mapOptionSchema(
            target,
            mission.scenario.setup.mapName,
          ),
          disabledUnits: mission.disabledUnits,
          // The run's level, by the one route a scenario's difficulty ever
          // reaches the engine: `launchScenario` writes the `coilbox_difficulty`
          // modoption. Left out for a mission that does not vary by it, and for
          // a run nobody has chosen a level for, so both produce the start
          // script they always did.
          difficulty: variesByDifficulty ? difficulty : undefined,
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
        // list. The snapshot holds only the options the author set, and the
        // game's own defaults fill the rest in `toBattleConfig`.
        launched = toBattleConfig({
          participants: snapshot.participants,
          mapName: map.name,
          gameType: game.name,
          startPosType: snapshot.startPosType,
          modOptions: snapshot.modOptionValues,
          optionSchema,
          mapOptionSchema: await mapOptionSchema(target, map.name),
          disabledUnits: mission.disabledUnits,
        });
        const res = await startEngine(launched);
        exitCode = res.exitCode;
      }
      // Cancelled before the game started: no outcome to report, no progress
      // written, no detection. Drop straight back to the briefing.
      if (exitCode === null) return;
      if (beforePaths === null) {
        // No baseline to detect a replay against, so a nonzero exit is read
        // the same way as "no replay found" below.
        const failure = engineFailureMessage(exitCode, false);
        if (failure) {
          setError(failure);
          return;
        }
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
      // A nonzero exit with no new replay is stronger than either signal
      // alone: the engine died before anything was recorded, so this says so
      // directly rather than asking the player to guess how the mission
      // ended. A nonzero exit alongside a replay is left to detection below,
      // since the engine can exit nonzero after a completed mission, and
      // that replay is real evidence not to discard.
      const failure = engineFailureMessage(exitCode, replay !== null);
      if (failure) {
        setError(failure);
        setPhase("briefing");
        return;
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
    variesByDifficulty,
    difficulty,
  ]);

  /**
   * Set the difficulty for this campaign run. It is the run's rather than this
   * mission's, so it holds for every mission after this one until it is changed
   * again, which is what lets a player stuck on mission 4 drop the level and
   * carry on.
   */
  const setDifficulty = useCallback(
    async (level: Difficulty) => {
      setError(null);
      try {
        await save(chooseDifficulty(progress, campaign.id, level));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [save, progress, campaign.id],
  );

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
    /** Why the mission cannot be played at all, whatever is installed. */
    unfinished,
    noEngine,
    scanLoading,
    running,
    saving,
    autoDetected,
    nextMission,
    /** Whether this mission plays differently at different difficulties. */
    variesByDifficulty,
    /** The run's chosen level, or undefined when nobody has chosen one. */
    difficulty,
    setDifficulty,
    start,
    recordVictory,
    recordDefeat,
    reset,
    /** Force a rescan so a just-installed game/map clears `missing` (install gate). */
    recheck: () => scan.run(true),
  };
}
