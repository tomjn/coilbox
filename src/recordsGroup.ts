/**
 * The sidebar group for records of games already played: Career, Player stats
 * and Replays. Three plugins put an item in it (`career`, `multiplayer`,
 * `play`), and picoframe merges groups with the same id, so the id, label and
 * position live here once.
 *
 * The label is provisional: the repo owner has not picked a name (issue #3455).
 * Renaming is a change to `label` below. The id stays `records`.
 *
 * `order` puts it straight after Multiplayer (10) and before Library (15).
 */
export const RECORDS_GROUP = {
  id: "records",
  label: "Records",
  order: 12,
} as const;
