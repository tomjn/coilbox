import { formatDuration } from "../lib/format";
import type { ResultChange, ResultRecord } from "../records/bestResult";
import type { SkirmishDraft } from "./drafts";
import { draftKey, type SkirmishPreset } from "./presets";

/**
 * Best results for skirmish presets, kept apart from the presets themselves.
 *
 * Presets are shared, exported and imported as they stand, so a record stored on
 * the preset would travel with it. A separate key keeps results on this machine.
 */
export const PRESET_RECORDS_KEY = "play.presetRecords";

/**
 * What a record is filed under: the setup's content, not the preset's name or
 * place in the list. A rename keeps the record. Editing the game, map, roster,
 * start positions or any option starts a new one, because that is a different
 * game to win. It is the key `presetMatchesDraft` already compares by.
 */
export function presetRecordKey(draft: SkirmishDraft): string {
  return draftKey(draft);
}

/**
 * The preset a launched setup counts against, or null when it counts against
 * none. A game counts when the setup at launch is a saved preset's setup, which
 * also covers an option changed and changed back.
 */
export function launchedPreset(
  presets: readonly SkirmishPreset[],
  launched: SkirmishDraft,
): { key: string; name: string } | null {
  const key = presetRecordKey(launched);
  const match = presets.find((p) => presetRecordKey(p) === key);
  return match ? { key, name: match.name } : null;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** One line for a preset's row. No best is shown unless a timed win exists. */
export function recordSummary(record: ResultRecord): string {
  const attempts = plural(record.attempts, "attempt");
  if (record.wins === 0) return `${attempts}, no wins`;
  const wins = plural(record.wins, "win");
  if (!record.best) return `${wins} in ${attempts}`;
  return `Best win ${formatDuration(record.best.durationSec)} · ${wins} in ${attempts}`;
}

/** The debrief's line about a game that counted, or null when there is none. */
export function describeChange(
  change: ResultChange,
  presetName: string,
): string | null {
  const name = `"${presetName}"`;
  switch (change.kind) {
    case "duplicate":
      return null;
    case "first-win":
      return `First win on ${name}, in ${formatDuration(change.durationSec)}.`;
    case "faster":
      return `New best on ${name}: ${formatDuration(change.bySec)} faster than before.`;
    case "slower":
      return `Not a new best on ${name}. This win was ${formatDuration(change.bySec)} slower than ${formatDuration(change.bestSec)}.`;
    case "equal":
      return `Matches your best on ${name}, ${formatDuration(change.bestSec)}.`;
    case "loss":
      return `Attempt recorded on ${name}.`;
    case "no-winner":
      return `Attempt recorded on ${name}, with no winner.`;
    case "win-no-time":
      return `Win recorded on ${name}, but the replay gave no time.`;
  }
}
