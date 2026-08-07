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

/**
 * The draft as it is stored: the setup, plus when the setup screen last wrote it.
 *
 * Kept apart from {@link SkirmishDraft} because a preset is a named draft
 * (`SkirmishPreset extends SkirmishDraft`) and carries its own `lastUsedAt`.
 * Only the working draft under `play.skirmish` is stamped.
 */
export interface StoredSkirmishDraft extends SkirmishDraft {
  /**
   * When `SkirmishPage` last persisted this draft, in ms since the epoch.
   *
   * Read by the welcome screen's Continue collector, which ranks what you were
   * last doing across every mode and so needs one comparable number per source.
   * Optional because a draft saved before this field existed has none: the
   * collector treats an unstamped draft as no candidate at all and offers a saved
   * preset instead, until the setup screen next writes.
   */
  touchedAt?: number;
}

export const defaultSkirmishDraft: SkirmishDraft = {
  participants: initialParticipants(),
  gameName: "",
  mapName: "",
  startPosType: 0,
  modOptionValues: {},
};

export function useSkirmishDraft() {
  return useSetting<StoredSkirmishDraft>("play.skirmish", defaultSkirmishDraft);
}
