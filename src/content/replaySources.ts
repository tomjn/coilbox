/**
 * Where a replay page's numbers come from, in one sentence each (#1173).
 *
 * A replay page mixes three kinds of source with different reliabilities, and
 * the docs page at {@link REPLAY_SOURCES_DOC_URL} explains each. The wording
 * lives here, once, so the sections that name their source cannot drift apart.
 */

/** The docs page that says what each source is, what it costs and how far to trust it. */
export const REPLAY_SOURCES_DOC_URL =
  "https://tomjn.github.io/coilbox/replay-data-sources";

const SETUP = "Names, sides and ratings come from the match setup.";
const TRAILER = "the engine's own record at the end of the match";

export const REPLAY_SOURCE_NOTES = {
  /** The roster with the match statistics hidden: the setup alone. */
  setup: SETUP,
  /** The roster: setup for who played, the engine's record for the figures. */
  players: `${SETUP} Totals and APM come from ${TRAILER}.`,
  /** The engine's record at the end of the match. */
  trailer: `From ${TRAILER}.`,
  /** The packets recorded during the match: what players asked for. */
  stream: "From the orders and messages recorded during the match.",
  /** What the simulation did when coilbox played the match back (#1160). */
  log: "From playing the match back with coilbox's own recorder, which is kept only when the playback reproduced the recorded match exactly. These are events, not orders.",
} as const;

export type ReplaySource = keyof typeof REPLAY_SOURCE_NOTES;
