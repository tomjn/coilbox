import { useCallback } from "react";
import type { SkirmishAi } from "../content/bindings";
import type { ReplayProvenance } from "../content/replayUserState";
import type { SkirmishDraft } from "../play/drafts";
import type { GameAiConfig } from "../play/gameAi";
import type { GameChoice, InstalledGame } from "../play/installedGames";
import { PLAYER_NAME, useBattleRun } from "../play/useBattleRun";
import { useConquestState } from "./conquests";
import { conquestGameRef, withGameChoice } from "./gameChoice";
import { scenarioToPlay, withScenarioWon } from "./handmade/conquest";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "./model";
import { advanceAfterBattle } from "./rules";
import { synthesizeBattle } from "./synthesize";

export type { BattleRequirement, BattleRunPhase } from "../play/useBattleRun";

/**
 * Drive one strategic battle: resolve the launch target and the galaxy's game
 * (newest installed version of its shortname), synthesize the skirmish for
 * the contested node, launch, detect the outcome from the replay (manual
 * prompt on ambiguity), then advance the conquest state through the full
 * post-battle pipeline and persist it.
 *
 * The launch/detect/manual-prompt state machine itself is
 * `play/useBattleRun`, shared with warpath's `useRunEncounter`. Only the
 * conquest-specific pieces (the disabled-unit-only snapshot, and advancing
 * through `advanceAfterBattle`) live here.
 *
 * A location on a hand-made map can name a scenario. The player's first attack
 * there plays it in place of the skirmish, through the launch a campaign
 * mission uses, and a win is recorded so it is not played twice. A defence of
 * that location, and any attack after the win, is a skirmish on the scenario's
 * map. See `scenarioToPlay`.
 */
export function useConquestBattleRun(
  galaxy: GalaxyDoc,
  state: ConquestState | undefined,
  node: GalaxyNode | undefined,
  mode: "attack" | "defend",
) {
  const { saveFor } = useConquestState();
  const scenario =
    state && node ? scenarioToPlay(state, node, mode) : undefined;

  // The node battle as a launchable skirmish snapshot: the synthesized roster
  // plus the node's disabled-unit restrictions, so "Save as preset" and the
  // live launch capture exactly the same fight. Conquest has no per-team perks.
  const snapshot = useCallback(
    (
      installedGame: InstalledGame,
      ais: SkirmishAi[],
      aiConfig: GameAiConfig | undefined,
    ): SkirmishDraft | null => {
      if (!state || !node) return null;
      const draft = synthesizeBattle(galaxy, state, node.id, mode, {
        playerName: PLAYER_NAME,
        gameName: installedGame.name,
        ais,
        aiConfig,
      });
      if (!draft) return null;
      const disabledUnits = node.battle.disabledUnits;
      return disabledUnits && disabledUnits.length > 0
        ? { ...draft, restrictions: { disabledUnits } }
        : draft;
    },
    [galaxy, state, node, mode],
  );

  // Only ever invoked once `hasDomainState` (below) has gated on `state` and
  // `node` both being present, so the guard here is defensive rather than a
  // reachable path. It also lets TypeScript narrow past the two `| undefined`s.
  const resolveOutcome = useCallback(
    (outcome: "victory" | "defeat"): ConquestState => {
      if (!state || !node) {
        throw new Error("resolveOutcome called before state/node were ready");
      }
      const next = advanceAfterBattle(galaxy, state, node.id, mode, outcome);
      // Only a win retires the scenario. After a defeat it is still there to
      // be tried again.
      return scenario && outcome === "victory"
        ? withScenarioWon(next, node.id)
        : next;
    },
    [galaxy, state, node, mode, scenario],
  );

  const persist = useCallback(
    (next: ConquestState) => saveFor(galaxy.id, next),
    [saveFor, galaxy.id],
  );

  // The player's answer about which game the run uses is saved on its state.
  const onGameChoice = useCallback(
    async (choice: GameChoice) => {
      if (!state) return;
      await saveFor(galaxy.id, withGameChoice(state, choice));
    },
    [saveFor, galaxy.id, state],
  );

  const provenance: ReplayProvenance = {
    mode: "conquest",
    galaxyId: galaxy.id,
    nodeId: node?.id,
  };

  const battle = useBattleRun<ConquestState>({
    launchMode: "conquest",
    gameRef: conquestGameRef(galaxy, state),
    declinedGameUpdate: state?.declinedGameUpdate,
    onGameChoice,
    mapName: node?.battle.mapName ?? "",
    canStartExtra: !!state && !!node && state.status === "active",
    hasDomainState: !!state && !!node,
    snapshot,
    resolveOutcome,
    persist,
    provenance,
    scenario,
  });
  return {
    ...battle,
    /** The scenario this fight plays, or undefined for a skirmish. */
    scenario: scenario?.doc,
  };
}
