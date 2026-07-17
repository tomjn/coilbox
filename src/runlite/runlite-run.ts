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
import type { BattleConfig } from "../play/bindings";
import type { PlayTarget } from "../play/config";
import {
  toBattleConfig,
  usePreferredTarget,
  useSkirmishAis,
} from "../play/config";
import {
  type DetectedResult,
  diffNewReplays,
  pickNewestReplay,
  resultFromDemoInfo,
} from "../play/detect";
import { usePlay } from "../play/PlayProvider";
import { applyPerks, disabledUnitsFor } from "./build";
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

async function detectBattleResult(opts: {
  target: PlayTarget;
  beforePaths: ReadonlySet<string>;
  playerName: string;
}): Promise<DetectedResult> {
  const { target, beforePaths, playerName } = opts;
  try {
    const replay = await findNewReplay(target.dataDir, beforePaths);
    if (!replay) return "ambiguous";
    const { info } = await contentDemoInfo({
      enginePath: target.enginePath,
      replayPath: replay.path,
    });
    return resultFromDemoInfo(info, playerName);
  } catch {
    return "ambiguous";
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
) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();

  const [phase, setPhase] = useState<BattleRunPhase>("briefing");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [resolved, setResolved] = useState<RogueliteRun | null>(null);

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
  const aiConfig = useBrandingEntry(installedGame)?.conquestAi;

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

  const start = useCallback(async () => {
    if (!target || !node || !installedGame) return;
    const draft = synthesizeEncounter(run, node, {
      playerName: PLAYER_NAME,
      gameName: installedGame.name,
      ais,
      aiConfig,
    });
    if (!draft) return;
    const edges = dataset
      ? buildEdgeMap(dataset.units)
      : new Map<string, string[]>();
    const config: BattleConfig = applyPerks(
      toBattleConfig({
        participants: draft.participants,
        mapName: draft.mapName,
        gameType: draft.gameName,
        startPosType: draft.startPosType,
        modOptions: draft.modOptionValues,
        disabledUnits: disabledUnitsFor(run, edges),
      }),
      run.progress.perks,
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
      if (res.exitCode === null) return;
      if (beforePaths === null) {
        setPhase("result");
        return;
      }
      setPhase("checking");
      const outcome = await detectBattleResult({
        target,
        beforePaths,
        playerName: PLAYER_NAME,
      }).catch((): DetectedResult => "ambiguous");
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
    run,
    ais,
    aiConfig,
    dataset,
    launch,
    applyResult,
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
    recordVictory,
    recordDefeat,
    recheck: () => scan.run(true),
  };
}
