import { useCallback } from "react";
import type { SkirmishAi } from "../content/bindings";
import { buildEdgeMap } from "../content/buildTree";
import { useUnitsyncScan, useUnitsyncUnitDataset } from "../content/config";
import type { ReplayProvenance } from "../content/replayUserState";
import { usePreferredTarget } from "../play/config";
import type { BattleRestrictions, SkirmishDraft } from "../play/drafts";
import type { GameAiConfig } from "../play/gameAi";
import type { InstalledGame } from "../play/installedGames";
import { resolveGameByShortname } from "../play/installedGames";
import { PLAYER_NAME, useBattleRun } from "../play/useBattleRun";
import { disabledUnitsFor, perkTotals } from "./build";
import type { RogueliteRun, RunNode } from "./model";
import { resolveBattle } from "./progress";
import { synthesizeEncounter } from "./synthesize";

export type { BattleRequirement, BattleRunPhase } from "../play/useBattleRun";

/**
 * Drive one run battle node: resolve the launch target and the run's game
 * (newest installed version of its shortname), synthesize the encounter, apply
 * the run's disabled set (shared tech ceiling) and personal perks, launch,
 * detect the outcome (manual prompt on ambiguity), then fold it through
 * `resolveBattle` and hand the next run back to `onResolved` to persist.
 *
 * The launch/detect/manual-prompt state machine itself is
 * `play/useBattleRun`, shared with conquest's `useConquestBattleRun`. Only the
 * warpath-specific pieces live here: the tech-ceiling-and-perks snapshot, and
 * folding the outcome through `resolveBattle`. The tech ceiling needs the
 * resolved target and installed game before the shared hook exists to hand
 * them back, so this re-resolves them (the same cached calls `useBattleRun`
 * makes internally) rather than threading them out through it.
 */
export function useRunEncounter(
  run: RogueliteRun,
  node: RunNode | undefined,
  onResolved: (next: RogueliteRun) => void | Promise<void>,
  /** The run's opaque id in `RunStateFile.runs` (see `runlite/runs.ts`), for
   * tagging a freshly-detected replay's provenance. */
  runId?: string,
) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const installedGame = resolveGameByShortname(
    run.settings.game,
    scan.data?.games ?? [],
  );

  // The unit dataset backs the shared tech ceiling. Without it nothing is
  // disabled (full arsenal), which is a safe fallback.
  const { dataset } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );

  // The encounter as a launchable skirmish snapshot: the synthesized roster plus
  // the run's faithful-replay restrictions (shared tech ceiling + personal perks),
  // so "Save as preset" and the live launch below capture exactly the same fight.
  const snapshot = useCallback(
    (
      installedGame: InstalledGame,
      ais: SkirmishAi[],
      aiConfig: GameAiConfig | undefined,
    ): SkirmishDraft | null => {
      if (!node) return null;
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
    },
    [run, node, dataset],
  );

  // Only ever invoked once `hasDomainState` (below) has gated on `node` being
  // present, so the guard here is defensive rather than a reachable path. It
  // also lets TypeScript narrow past the `| undefined`.
  const resolveOutcome = useCallback(
    (outcome: "victory" | "defeat"): RogueliteRun => {
      if (!node) {
        throw new Error("resolveOutcome called before node was ready");
      }
      return resolveBattle(run, node.id, outcome);
    },
    [run, node],
  );

  const persist = useCallback(
    (next: RogueliteRun) => Promise.resolve(onResolved(next)),
    [onResolved],
  );

  const provenance: ReplayProvenance = {
    mode: "warpath",
    runId,
    nodeId: node?.id,
  };

  return useBattleRun<RogueliteRun>({
    launchMode: "runlite",
    gameRef: run.settings.game,
    mapName: node?.battle?.mapName ?? "",
    canStartExtra: !!node && !!node.battle && run.progress.status === "active",
    hasDomainState: !!node,
    snapshot,
    resolveOutcome,
    persist,
    provenance,
  });
}
