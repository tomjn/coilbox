import { useCallback } from "react";
import type { SkirmishAi } from "../content/bindings";
import type { ReplayProvenance } from "../content/replayUserState";
import type { SkirmishDraft } from "../play/drafts";
import type { GameAiConfig } from "../play/gameAi";
import type { InstalledGame } from "../play/installedGames";
import { PLAYER_NAME, useBattleRun } from "../play/useBattleRun";
import { useConquestState } from "./conquests";
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
 */
export function useConquestBattleRun(
  galaxy: GalaxyDoc,
  state: ConquestState | undefined,
  node: GalaxyNode | undefined,
  mode: "attack" | "defend",
) {
  const { saveFor } = useConquestState();

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
      return advanceAfterBattle(galaxy, state, node.id, mode, outcome);
    },
    [galaxy, state, node, mode],
  );

  const persist = useCallback(
    (next: ConquestState) => saveFor(galaxy.id, next),
    [saveFor, galaxy.id],
  );

  const provenance: ReplayProvenance = {
    mode: "conquest",
    galaxyId: galaxy.id,
    nodeId: node?.id,
  };

  return useBattleRun<ConquestState>({
    launchMode: "conquest",
    gameRef: galaxy.game,
    mapName: node?.battle.mapName ?? "",
    canStartExtra: !!state && !!node && state.status === "active",
    hasDomainState: !!state && !!node,
    snapshot,
    resolveOutcome,
    persist,
    provenance,
  });
}
