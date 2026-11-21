import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * The two entries in the chart's metric list that are not trailer statistics
 * (#5321). Each is drawn from other data, so each has a key of its own, and
 * `ChartChoice` carries it as a plain string beside the registry's keys.
 *
 * They sit in a group after the registry's, because the registry is the
 * trailer's fields and these are read from the replay when picked.
 */
export const COMMAND_RATE_KEY = "commandRate";
export const LIVING_VALUE_KEY = "livingValue";

export interface ReplayEntry {
  key: string;
  label: MessageDescriptor;
}

export const REPLAY_ENTRIES: ReplayEntry[] = [
  { key: COMMAND_RATE_KEY, label: msg`Commands per minute` },
  { key: LIVING_VALUE_KEY, label: msg`Living unit value` },
];

/** The list's heading over {@link REPLAY_ENTRIES}. */
export const REPLAY_ENTRIES_HEADING = msg`From the replay`;

/** The entry a chart choice names, or undefined when it names a metric. */
export function replayEntry(key: string | null): ReplayEntry | undefined {
  return REPLAY_ENTRIES.find((e) => e.key === key);
}

export const labelOfEntry = (entry: ReplayEntry): string => i18n._(entry.label);
