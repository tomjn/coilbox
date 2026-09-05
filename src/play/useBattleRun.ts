import { useCallback, useState } from "react";
import type { GameRef } from "../conquest/model";
import { contentListReplays, type SkirmishAi } from "../content/bindings";
import { useBrandingEntry } from "../content/branding";
import { useUnitsyncScan } from "../content/config";
import type { ReplayProvenance } from "../content/replayUserState";
import { useReplayUserState } from "../content/replayUserState";
import { getProfile } from "../profile/profile";
import {
  applyRestrictions,
  gameOptionSchema,
  mapOptionSchema,
  toBattleConfig,
  usePreferredTarget,
  useSkirmishAis,
} from "./config";
import {
  type DetectedResult,
  detectBattleResult,
  engineFailureMessage,
} from "./detect";
import type { SkirmishDraft } from "./drafts";
import type { GameAiConfig } from "./gameAi";
import { mergeGameAi } from "./gameAi";
import type { InstalledGame } from "./installedGames";
import { resolveGameByShortname } from "./installedGames";
import { usePlay } from "./PlayProvider";

/* -------------------------------------------------------------------------- *
 * The battle hook shared by conquest (`useConquestBattleRun`) and warpath
 * (`useRunEncounter`): install check, launch, automatic result detection from
 * the replay, and the manual result flow as its fallback. See issue #2439.
 *
 * The two modes are not identical. Conquest advances a strategic map through
 * `advanceAfterBattle`, while warpath folds salvage/hull/perks through
 * `resolveBattle` and layers a shared tech ceiling plus personal perks onto
 * the launch config. Rather than flatten those into this hook, each caller
 * keeps its own `snapshot`/`resolveOutcome`/`persist` and hands this hook the
 * result. Everything below is the state machine the two share byte for byte.
 * -------------------------------------------------------------------------- */

/** Phases of the battle screen, matching the campaign flow:
 *   briefing → (launch) → checking → result → victory | defeat
 * A cancelled launch returns to `briefing`, and nothing is consumed. */
export type BattleRunPhase =
  | "briefing"
  | "checking"
  | "result"
  | "victory"
  | "defeat";

/** What the battle needs installed before it can launch. The game resolves by
 * shortname (newest installed version), and the map is an exact-name match. */
export interface BattleRequirement {
  kind: "game" | "map";
  name: string;
}

/** The player participant's display name in synthesized battles. */
export const PLAYER_NAME = "You";

export interface UseBattleRunOptions<TResolved> {
  /** The `usePlay().launch` kind this mode launches as. */
  launchMode: "conquest" | "runlite";
  /** The game to resolve against the installed list. */
  gameRef: GameRef;
  /** The current node's map name, or `""` when there's no node yet. */
  mapName: string;
  /**
   * Extra readiness beyond target/scan/install/AIs, folded into `canStart`
   * only. Conquest requires a loaded, active `ConquestState`, while warpath
   * requires the node to carry a battle and the run to be active. Neither
   * side's original `start()`/`applyResult()` re-checked this, so it stays
   * out of those guards too (see `hasDomainState`).
   */
  canStartExtra: boolean;
  /**
   * Whether the domain object a launch needs to resolve into exists.
   * Conquest's optional `ConquestState` plus its node, warpath's `run` is
   * always present so this is just its node. Gates `start()` (alongside
   * `target`/`installedGame`) and `applyResult()`, matching each caller's
   * original guard exactly.
   */
  hasDomainState: boolean;
  /**
   * Build the launchable draft for the current node. Conquest applies only
   * `disabledUnits`, while warpath also layers the shared tech ceiling and
   * perk totals. That is a real difference, so this stays a caller-supplied
   * function rather than something this hook tries to generalise.
   */
  snapshot: (
    installedGame: InstalledGame,
    ais: SkirmishAi[],
    aiConfig: GameAiConfig | undefined,
  ) => SkirmishDraft | null;
  /** Resolve an outcome into the next domain state, pure, no I/O. */
  resolveOutcome: (outcome: "victory" | "defeat") => TResolved;
  /** Persist the resolved state. */
  persist: (next: TResolved) => Promise<void>;
  /** Provenance to attach to a freshly-detected replay. */
  provenance: ReplayProvenance;
}

/**
 * Drive one battle: resolve the launch target and the mode's game (newest
 * installed version of its shortname), build the launch config from the
 * caller's snapshot, launch, detect the outcome from the replay (manual
 * prompt on ambiguity), then hand the outcome to the caller's
 * `resolveOutcome`/`persist`.
 */
export function useBattleRun<TResolved>(opts: UseBattleRunOptions<TResolved>) {
  const {
    launchMode,
    gameRef,
    mapName,
    canStartExtra,
    hasDomainState,
    snapshot: buildSnapshot,
    resolveOutcome,
    persist,
    provenance,
  } = opts;

  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();
  const { setProvenance } = useReplayUserState();

  const [phase, setPhase] = useState<BattleRunPhase>("briefing");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  // The state as it was after the battle resolved (for the result screens,
  // since the caller's own domain state refreshes underneath once saved).
  const [resolved, setResolved] = useState<TResolved | null>(null);
  // The exact draft last launched, so saving a preset from the *outcome*
  // screen captures the fight as fought rather than a fresh (already
  // advanced) `snapshot()`.
  const [lastSnapshot, setLastSnapshot] = useState<SkirmishDraft | null>(null);

  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];
  const scanReady = !!scan.data;

  const installedGame = resolveGameByShortname(gameRef, games);
  const missing: BattleRequirement | null = !scanReady
    ? null
    : !installedGame
      ? { kind: "game", name: gameRef.pinnedName ?? gameRef.shortname }
      : !maps.some((m) => m.name === mapName)
        ? { kind: "map", name: mapName }
        : null;

  const { ais } = useSkirmishAis(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  // The game's AI catalogue: the branding entry's, with any profile override
  // on top. Called unconditionally, since useBrandingEntry accepts undefined.
  const brandingAi = useBrandingEntry(installedGame)?.ai;
  const aiConfig = mergeGameAi(getProfile().ai, brandingAi);

  const noEngine = !targetLoading && !target;
  const scanLoading = !!target && !scanReady && scan.loading;
  const canStart =
    !!target &&
    scanReady &&
    !missing &&
    !running &&
    !scan.loading &&
    ais.length > 0 &&
    canStartExtra;

  /** Advance through the resolved battle and persist. Shared by the manual
   * buttons and automatic detection. */
  const applyResult = useCallback(
    async (outcome: "victory" | "defeat", auto: boolean) => {
      if (!hasDomainState) return;
      setSaving(true);
      setError(null);
      try {
        const next = resolveOutcome(outcome);
        await persist(next);
        setResolved(next);
        setAutoDetected(auto);
        setPhase(outcome);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        // Never strand the player on "checking": fall back to the manual
        // prompt, which shows this error and offers the buttons again.
        setPhase("result");
      } finally {
        setSaving(false);
      }
    },
    [hasDomainState, resolveOutcome, persist],
  );

  const snapshot = useCallback((): SkirmishDraft | null => {
    if (!installedGame) return null;
    return buildSnapshot(installedGame, ais, aiConfig);
  }, [installedGame, ais, aiConfig, buildSnapshot]);

  const start = useCallback(async () => {
    if (!target || !hasDomainState || !installedGame) return;
    const draft = snapshot();
    if (!draft) return;
    setLastSnapshot(draft);
    const config = applyRestrictions(
      toBattleConfig({
        participants: draft.participants,
        mapName: draft.mapName,
        gameType: draft.gameName,
        startPosType: draft.startPosType,
        modOptions: draft.modOptionValues,
        optionSchema: await gameOptionSchema(
          target,
          installedGame.primaryArchive.name,
        ),
        mapOptionSchema: await mapOptionSchema(target, draft.mapName),
        disabledUnits: draft.restrictions?.disabledUnits,
      }),
      draft.restrictions,
    );
    setError(null);
    // Snapshot the replays that exist before the engine runs. A failure here
    // only disables detection, never the launch.
    let beforePaths: Set<string> | null = null;
    try {
      const { replays } = await contentListReplays({ root: target.dataDir });
      beforePaths = new Set(replays.map((r) => r.path));
    } catch {
      beforePaths = null;
    }
    try {
      const res = await launch(launchMode, {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      // Cancelled before the game started: nothing consumed, no detection.
      if (res.exitCode === null) return;
      const exitCode = res.exitCode;
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
      const { outcome, replay } = await detectBattleResult({
        target,
        beforePaths,
        playerName: PLAYER_NAME,
      }).catch((): { outcome: DetectedResult; replay: null } => ({
        outcome: "ambiguous",
        replay: null,
      }));
      // Tag the replay with where it came from the moment its filename is
      // known, regardless of whether the outcome itself was readable.
      if (replay) {
        setProvenance(replay.filename, provenance);
      }
      // A nonzero exit with no new replay is stronger than either signal
      // alone: the engine died before anything was recorded, so this says so
      // directly rather than asking the player to guess how the battle ended.
      // A nonzero exit alongside a replay is left to detection below, since
      // the engine can exit nonzero after a completed battle, and that
      // replay is real evidence not to discard.
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
    hasDomainState,
    installedGame,
    snapshot,
    launch,
    launchMode,
    applyResult,
    provenance,
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
    resolved,
    installedGame,
    ais,
    start,
    snapshot,
    lastSnapshot,
    recordVictory,
    recordDefeat,
    /** Force a rescan so a just-installed game/map clears `missing`. */
    recheck: () => scan.run(true),
  };
}
