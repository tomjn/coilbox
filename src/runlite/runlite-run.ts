import { useCallback, useState } from "react";
import { resolveGameByShortname } from "../conquest/model";
import {
  contentDemoInfo,
  contentListReplays,
  type ReplayFile,
} from "../content/bindings";
import { useBrandingEntry } from "../content/branding";
import { buildEdgeMap } from "../content/buildTree";
import { useUnitsyncScan, useUnitsyncUnitDataset } from "../content/config";
import { useReplayUserState } from "../content/replayUserState";
import type { BattleConfig } from "../play/bindings";
import type { PlayTarget } from "../play/config";
import {
  applyRestrictions,
  gameOptionSchema,
  mapOptionSchema,
  toBattleConfig,
  usePreferredTarget,
  useSkirmishAis,
} from "../play/config";
import {
  type DetectedResult,
  diffNewReplays,
  engineFailureMessage,
  pickNewestReplay,
  resultFromDemoInfo,
} from "../play/detect";
import type { BattleRestrictions, SkirmishDraft } from "../play/drafts";
import { mergeGameAi } from "../play/gameAi";
import { usePlay } from "../play/PlayProvider";
import { getProfile } from "../profile/profile";
import { disabledUnitsFor, perkTotals } from "./build";
import type { RogueliteRun, RunNode } from "./model";
import { resolveBattle } from "./progress";
import { synthesizeEncounter } from "./synthesize";

/* -------------------------------------------------------------------------- *
 * The run battle hook — mirrors conquest's `useConquestBattleRun`: install
 * check, launch, automatic result detection from the replay, and the manual
 * result flow as its fallback. On a resolved outcome the pure `resolveBattle`
 * transition runs (salvage/hull/status) and the caller persists via `onResolved`.
 * -------------------------------------------------------------------------- */

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Mirrors conquest's `detectBattleResult`: the replay (when found) comes back
 * alongside the outcome so the caller can tag it with provenance the moment
 * its filename is known. */
async function detectBattleResult(opts: {
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

export type BattleRunPhase =
  | "briefing"
  | "checking"
  | "result"
  | "victory"
  | "defeat";

/** What a battle needs installed before it can launch. */
export interface BattleRequirement {
  kind: "game" | "map";
  name: string;
}

/** The player participant's display name in synthesized encounters. */
const PLAYER_NAME = "You";

/**
 * Drive one run battle node: resolve the launch target and the run's game
 * (newest installed version of its shortname), synthesize the encounter, apply
 * the run's disabled set (shared tech ceiling) and personal perks, launch,
 * detect the outcome (manual prompt on ambiguity), then fold it through
 * `resolveBattle` and hand the next run back to `onResolved` to persist.
 */
export function useRunEncounter(
  run: RogueliteRun,
  node: RunNode | undefined,
  onResolved: (next: RogueliteRun) => void | Promise<void>,
  /** The run's opaque id in `RunStateFile.runs` (see `runlite/runs.ts`), for
   * tagging a freshly-detected replay's provenance. */
  runId?: string,
) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();
  const { setProvenance } = useReplayUserState();

  const [phase, setPhase] = useState<BattleRunPhase>("briefing");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [resolved, setResolved] = useState<RogueliteRun | null>(null);
  // The exact draft last launched, so saving a preset from the *outcome* screen
  // captures the fight as fought — the run's progress (unlocks/perks) has already
  // advanced by then, so a fresh `snapshot()` would describe a different battle.
  const [lastSnapshot, setLastSnapshot] = useState<SkirmishDraft | null>(null);

  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];
  const scanReady = !!scan.data;

  const installedGame = resolveGameByShortname(run.settings.game, games);
  const mapName = node?.battle?.mapName ?? "";
  const missing: BattleRequirement | null = !scanReady
    ? null
    : !installedGame
      ? {
          kind: "game",
          name: run.settings.game.pinnedName ?? run.settings.game.shortname,
        }
      : !maps.some((m) => m.name === mapName)
        ? { kind: "map", name: mapName }
        : null;

  const { ais } = useSkirmishAis(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  const brandingAi = useBrandingEntry(installedGame)?.ai;
  const aiConfig = mergeGameAi(getProfile().ai, brandingAi);

  // The unit dataset backs the shared tech ceiling; without it nothing is
  // disabled (full arsenal), which is a safe fallback.
  const { dataset } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );

  const noEngine = !targetLoading && !target;
  const scanLoading = !!target && !scanReady && scan.loading;
  const canStart =
    !!target &&
    scanReady &&
    !missing &&
    !running &&
    !scan.loading &&
    !!node &&
    !!node.battle &&
    run.progress.status === "active" &&
    ais.length > 0;

  const applyResult = useCallback(
    async (outcome: "victory" | "defeat", auto: boolean) => {
      if (!node) return;
      setSaving(true);
      setError(null);
      try {
        const next = resolveBattle(run, node.id, outcome);
        await onResolved(next);
        setResolved(next);
        setAutoDetected(auto);
        setPhase(outcome);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("result");
      } finally {
        setSaving(false);
      }
    },
    [run, node, onResolved],
  );

  // The encounter as a launchable skirmish snapshot: the synthesized roster plus
  // the run's faithful-replay restrictions (shared tech ceiling + personal perks),
  // so "Save as preset" and the live launch below capture exactly the same fight.
  const snapshot = useCallback((): SkirmishDraft | null => {
    if (!node || !installedGame) return null;
    const draft = synthesizeEncounter(run, node, {
      playerName: PLAYER_NAME,
      gameName: installedGame.name,
      ais,
      aiConfig,
    });
    if (!draft) return null;
    const edges = dataset
      ? buildEdgeMap(dataset.units)
      : new Map<string, string[]>();
    const disabledUnits = disabledUnitsFor(run, edges);
    const { advantage, income } = perkTotals(run.progress.perks);
    const restrictions: BattleRestrictions = {};
    if (disabledUnits.length > 0) restrictions.disabledUnits = disabledUnits;
    if (advantage > 0) restrictions.advantage = advantage;
    if (income > 0) restrictions.incomeMultiplier = income;
    return Object.keys(restrictions).length > 0
      ? { ...draft, restrictions }
      : draft;
  }, [node, installedGame, run, ais, aiConfig, dataset]);

  const start = useCallback(async () => {
    if (!target || !node || !installedGame) return;
    const draft = snapshot();
    if (!draft) return;
    setLastSnapshot(draft);
    const config: BattleConfig = applyRestrictions(
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
    let beforePaths: Set<string> | null = null;
    try {
      const { replays } = await contentListReplays({ root: target.dataDir });
      beforePaths = new Set(replays.map((r) => r.path));
    } catch {
      beforePaths = null;
    }
    try {
      const res = await launch("runlite", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      // Cancelled before the game started: nothing to debrief.
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
      if (replay) {
        setProvenance(replay.filename, {
          mode: "warpath",
          runId,
          nodeId: node.id,
        });
      }
      // A nonzero exit with no new replay is stronger than either signal
      // alone: the engine died before anything was recorded, so this says so
      // directly rather than asking the player to guess how the fight ended.
      // A nonzero exit alongside a replay is left to detection below, since
      // the engine can exit nonzero after a completed game, and that replay
      // is real evidence not to discard.
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
    node,
    installedGame,
    snapshot,
    launch,
    applyResult,
    runId,
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
    recheck: () => scan.run(true),
  };
}
