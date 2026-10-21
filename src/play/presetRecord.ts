import { plural, t } from "@lingui/core/macro";
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

/** One line for a preset's row. No best is shown unless a timed win exists. */
export function recordSummary(record: ResultRecord): string {
  const attempts = plural(record.attempts, {
    one: "# attempt",
    other: "# attempts",
  });
  if (record.wins === 0) return t`${attempts}, no wins`;
  const wins = plural(record.wins, { one: "# win", other: "# wins" });
  if (!record.best) return t`${wins} in ${attempts}`;
  const bestTime = formatDuration(record.best.durationSec);
  return t`Best win ${bestTime} · ${wins} in ${attempts}`;
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
    case "first-win": {
      const time = formatDuration(change.durationSec);
      return t`First win on ${name}, in ${time}.`;
    }
    case "faster": {
      const faster = formatDuration(change.bySec);
      return t`New best on ${name}: ${faster} faster than before.`;
    }
    case "slower": {
      const slower = formatDuration(change.bySec);
      const best = formatDuration(change.bestSec);
      return t`Not a new best on ${name}. This win was ${slower} slower than ${best}.`;
    }
    case "equal": {
      const best = formatDuration(change.bestSec);
      return t`Matches your best on ${name}, ${best}.`;
    }
    case "loss":
      return t`Attempt recorded on ${name}.`;
    case "no-winner":
      return t`Attempt recorded on ${name}, with no winner.`;
    case "win-no-time":
      return t`Win recorded on ${name}, but the replay gave no time.`;
  }
}
