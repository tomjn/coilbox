import { aiGameFor } from "@/content/aiRecord";
import type { StatRecord } from "@/content/bindings";
import { isGenuineMatch } from "@/content/stats";
import { HANDICAP_TWEAKS } from "./debrief";
import { effectiveTeams, type Participant } from "./participants";

/**
 * A first rule for a bonus to try against an AI, built from the steps "Rematch
 * with a tweak" already uses. It has not been tuned by play.
 *
 * Take your newest decided game against this AI on this game. After a win, add
 * the smaller of the "harder" steps to that game's bonus. After a loss, add the
 * "easier" step. Clamp to 0..100.
 *
 * Matching: the AI by `shortName`, ignoring case and version, and the game by
 * the exact `gameType` string the replay recorded, which is how `aiRecord.ts`
 * groups a game.
 */

export interface BonusSuggestion {
  /** The bonus to try, in percent. */
  percent: number;
  /** The bonus the last decided game was played at, in percent. */
  from: number;
  result: "win" | "loss";
  /** The replay the suggestion came from. */
  filename: string;
}

/** Smallest positive step: the gentlest way "Rematch with a tweak" goes harder. */
const HARDER_STEP = Math.min(
  ...HANDICAP_TWEAKS.filter((t) => t.delta > 0).map((t) => t.delta),
);
/** The negative step closest to zero: the gentlest way to go easier. */
const EASIER_STEP = Math.max(
  ...HANDICAP_TWEAKS.filter((t) => t.delta < 0).map((t) => t.delta),
);

const newestFirst = (a: StatRecord, b: StatRecord) =>
  b.startTimeMs - a.startTimeMs || b.modifiedMs - a.modifiedMs;

/** What the setup shows: one per bonus control that has a suggestion. */
export interface BonusSuggestions {
  /** Keyed by participant id, for the per-row controls. */
  rows: Record<string, BonusSuggestion>;
  /** For "Bonus for every AI". Set only when every AI in the setup is one kind. */
  all: BonusSuggestion | null;
}

const NONE: BonusSuggestions = { rows: {}, all: null };

/**
 * The suggestions for a setup. With two or more AIs and all of one kind, one
 * suggestion for the footer's "Bonus for every AI". Otherwise one per AI row
 * that has a bonus control, so a row sharing a team gets none. A setup mixing
 * kinds never uses the footer, because applying it would change the other kind
 * too, so two rows of one kind in a mixed setup each get their own.
 */
export function bonusSuggestionsFor({
  participants,
  gameName,
  records,
  refights,
  scripted,
}: {
  participants: Participant[];
  gameName: string;
  records: StatRecord[];
  refights: ReadonlySet<string>;
  scripted: ReadonlySet<string>;
}): BonusSuggestions {
  const me = participants.find((p) => p.kind === "you")?.name;
  const aiRows = participants.filter((p) => p.kind === "ai");
  if (!me || aiRows.length === 0 || records.length === 0) return NONE;
  const ask = (aiShortName: string, currentBonus: number | null) =>
    suggestAiBonus({
      aiShortName,
      gameName,
      currentBonus,
      me,
      records,
      refights,
      scripted,
    });

  const kinds = new Set(aiRows.map((p) => p.ai?.shortName.toLowerCase()));
  const first = aiRows[0].ai?.shortName;
  if (aiRows.length >= 2 && kinds.size === 1 && first) {
    const bonuses = new Set(aiRows.map((p) => p.handicap ?? 0));
    const all = ask(first, bonuses.size === 1 ? [...bonuses][0] : null);
    return all ? { rows: {}, all } : NONE;
  }

  const { leaderIdByTeam } = effectiveTeams(participants);
  const leaders = new Set(leaderIdByTeam);
  const rows: Record<string, BonusSuggestion> = {};
  for (const p of aiRows) {
    if (!p.ai || !leaders.has(p.id)) continue;
    const found = ask(p.ai.shortName, p.handicap ?? 0);
    if (found) rows[p.id] = found;
  }
  return { rows, all: null };
}

/**
 * The suggestion for one AI, or null. `currentBonus` is the bonus set now, in
 * percent, or null when it differs between the AIs the suggestion would apply
 * to (so it can never match).
 */
export function suggestAiBonus({
  aiShortName,
  gameName,
  currentBonus,
  me,
  records,
  refights,
  scripted,
}: {
  aiShortName: string;
  gameName: string;
  currentBonus: number | null;
  me: string;
  records: StatRecord[];
  refights: ReadonlySet<string>;
  scripted: ReadonlySet<string>;
}): BonusSuggestion | null {
  const wanted = aiShortName.toLowerCase();
  const candidates = records
    .filter(
      (r) =>
        r.gameType === gameName &&
        isGenuineMatch(r, refights) &&
        !scripted.has(r.filename),
    )
    .sort(newestFirst);

  for (const record of candidates) {
    const played = aiGameFor(record, me);
    if (!played || played.result === "undecided") continue;
    const foes = played.opponents.filter(
      (a) => a.shortName.toLowerCase() === wanted,
    );
    if (foes.length === 0) continue;

    // This is the newest decided game against the AI. If its bonus cannot be
    // read as one number, say nothing rather than fall back to an older game.
    if (foes.some((a) => (a.incomeMultiplier ?? 1) !== 1)) return null;
    const bonuses = new Set(
      foes.map((a) => Math.max(0, Math.round((a.advantage ?? 0) * 100))),
    );
    if (bonuses.size !== 1) return null;
    const from = [...bonuses][0];

    const step = played.result === "win" ? HARDER_STEP : EASIER_STEP;
    const percent = Math.max(0, Math.min(100, from + step));
    if (percent === currentBonus) return null;
    return { percent, from, result: played.result, filename: record.filename };
  }
  return null;
}
