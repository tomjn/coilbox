import { useCallback, useMemo } from "react";
import type { NodeScenario } from "../conquest/model";
import type { SkirmishAi } from "../content/bindings";
import { useUnitsyncScan, useUnitsyncUnitDataset } from "../content/config";
import type { ReplayProvenance } from "../content/replayUserState";
import { usePreferredTarget } from "../play/config";
import type { BattleRestrictions, SkirmishDraft } from "../play/drafts";
import type { GameAiConfig } from "../play/gameAi";
import type { GameChoice, InstalledGame } from "../play/installedGames";
import { decideLaunchGame } from "../play/installedGames";
import { PLAYER_NAME, useBattleRun } from "../play/useBattleRun";
import { perkTotals } from "./build";
import { withGameChoice } from "./gameChoice";
import type { RogueliteRun, RunNode } from "./model";
import { resolveBattle } from "./progress";
import { synthesizeEncounter } from "./synthesize";
import { limitReadiness } from "./unitLimit";

export type { BattleRequirement, BattleRunPhase } from "../play/useBattleRun";

/**
 * Drive one run battle node: resolve the launch target and the run's game
 * (see `decideLaunchGame`), synthesize the encounter, apply
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
 * makes internally) rather than threading them out through it. The launch
 * waits for the unit data the limit needs, and does not go ahead without it.
 *
 * A node on a hand-made map can play a scenario in place of its encounter. It
 * is launched the way a campaign mission's scenario is and plays as its author
 * set it up: the run's unit limit and perks are not applied to it. The result
 * is folded through `resolveBattle` like any other, so a win clears the node
 * and a defeat costs hull.
 */
export function useRunEncounter(
  run: RogueliteRun,
  node: RunNode | undefined,
  onResolved: (next: RogueliteRun) => void | Promise<void>,
  /** The run's opaque id in `RunStateFile.runs` (see `runlite/runs.ts`), for
   * tagging a freshly-detected replay's provenance. */
  runId?: string,
  /** The scenario this node plays, from `runNodeScenario`. Given, the fight
   * is the scenario and not the node's encounter. */
  scenario?: NodeScenario,
) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // The game the battle launches, decided the way `useBattleRun` decides it, so
  // the unit data read here is the data of the game that runs. An unpinned run
  // with several candidate games has none until the player answers the offer.
  const decision = decideLaunchGame(
    run.settings.game,
    scan.data?.games ?? [],
    run.declinedGameUpdate,
  );
  const launchGame = decision.kind === "ready" ? decision.game : undefined;

  // The unit dataset backs the shared tech ceiling. A launch waits for it, and
  // a load that failed stops the launch rather than running with no limit
  // (issue #3473).
  const {
    dataset,
    status: datasetStatus,
    reload: reloadUnitData,
  } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    launchGame?.primaryArchive.name,
  );
  const limit = useMemo(
    () => limitReadiness(run, { status: datasetStatus, units: dataset?.units }),
    [run, datasetStatus, dataset],
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
      if (!node || limit.kind !== "ready") return null;
      const draft = synthesizeEncounter(run, node, {
        playerName: PLAYER_NAME,
        gameName: installedGame.name,
        ais,
        aiConfig,
      });
      if (!draft) return null;
      const disabledUnits =
        limit.limit.kind === "limited" ? limit.limit.disabled : [];
      const { advantage, income } = perkTotals(run.progress.perks);
      const restrictions: BattleRestrictions = {};
      if (disabledUnits.length > 0) restrictions.disabledUnits = disabledUnits;
      if (advantage > 0) restrictions.advantage = advantage;
      if (income > 0) restrictions.incomeMultiplier = income;
      return Object.keys(restrictions).length > 0
        ? { ...draft, restrictions }
        : draft;
    },
    [run, node, limit],
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

  // The player's answer about which game the run uses is saved on the run.
  const onGameChoice = useCallback(
    (choice: GameChoice) =>
      Promise.resolve(onResolved(withGameChoice(run, choice))),
    [run, onResolved],
  );

  const provenance: ReplayProvenance = {
    mode: "warpath",
    runId,
    nodeId: node?.id,
  };

  const battle = useBattleRun<RogueliteRun>({
    launchMode: "runlite",
    gameRef: run.settings.game,
    declinedGameUpdate: run.declinedGameUpdate,
    onGameChoice,
    // A scenario is set on its own map, whatever the encounter's became.
    mapName: scenario?.doc.setup.mapName ?? node?.battle?.mapName ?? "",
    canStartExtra: !!node && !!node.battle && run.progress.status === "active",
    hasDomainState: !!node,
    snapshot,
    resolveOutcome,
    persist,
    provenance,
    scenario,
  });

  return {
    ...battle,
    // The launch waits for the limit to be known. A scenario does not use it.
    canStart: battle.canStart && (!!scenario || limit.kind === "ready"),
    limit,
    reloadUnitData,
  };
}
