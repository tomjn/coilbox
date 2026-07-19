import { useSetting } from "@picoframe/frame";
import { initialParticipants, type Participant } from "./config";

/**
 * Faithful-replay levers a saved battle can carry beyond the roster. Conquest and
 * warpath nodes fight under engine restrictions the participant list can't express:
 * a shared disabled-unit ceiling (`[RESTRICT]`) and warpath's personal perks
 * (team-0 `Advantage`/`IncomeMultiplier`). When a preset captured from one of those
 * surfaces holds these, `SkirmishPage` re-applies them on launch so the replay is
 * the same fight. All optional — a hand-built skirmish carries none.
 */
export interface BattleRestrictions {
  /** Units disabled for every team (engine `[RESTRICT]` limit 0). */
  disabledUnits?: string[];
  /** Addend to team-0 `Advantage` (fraction; 0.1 = +10%). */
  advantage?: number;
  /** Addend to team-0 `IncomeMultiplier` (default 1). */
  incomeMultiplier?: number;
}

/**
 * Working draft for the Singleplayer (skirmish) launcher, persisted through the
 * frame settings store. The page holds its selections in local state for snappy
 * editing; this draft backs that state so navigating away (or restarting the
 * app) doesn't lose the setup — the picked game, map, opponents and options all
 * come back. Transient run state (running/error) is intentionally not persisted.
 */
export interface SkirmishDraft {
  participants: Participant[];
  gameName: string;
  mapName: string;
  startPosType: number;
  modOptionValues: Record<string, string>;
  /** Faithful-replay restrictions from a captured conquest/warpath/MP battle. */
  restrictions?: BattleRestrictions;
}

export const defaultSkirmishDraft: SkirmishDraft = {
  participants: initialParticipants(),
  gameName: "",
  mapName: "",
  startPosType: 0,
  modOptionValues: {},
};

export function useSkirmishDraft() {
  return useSetting<SkirmishDraft>("play.skirmish", defaultSkirmishDraft);
}
