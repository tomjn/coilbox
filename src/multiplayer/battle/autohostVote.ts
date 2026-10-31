/**
 * Reading a SPADS vote out of the room's chat (issue #4918).
 *
 * SPADS puts a command to a vote instead of running it when the sender's level
 * only reaches the command's vote level. `etc/commands.conf` gives `[set]` and
 * `[bSet]` a direct level of 100 and a vote level of 10, and `!map` is rewritten
 * to `set map <name>`. With `autoCallvote` on, `handleRequest` turns the refused
 * command into `hCallVote` (`spads.pl`), which says these lines to the room:
 *
 *   <user> called a vote for command "<command>" [!vote y, !vote n, !vote b]
 *   Vote for command "<command>" passed.
 *   Vote for command "<command>" passed (delay expired...).
 *   Vote for command "<command>" failed.
 *   Vote for command "<command>" failed (delay expired...).
 *   Vote cancelled by <user>
 *
 * A passed vote runs the command at once, so the command's own reply follows
 * the "passed" line. A failed vote never runs it. `<command>` is the command as
 * parsed, so `set teamSize 3` keeps the case it was typed in and `!map` shows as
 * `set map <the map SPADS matched>`.
 */

export type VoteState = "none" | "open" | "passed" | "failed";

/**
 * How long SPADS lets a vote run before it counts the votes: its `voteTime`
 * setting, which a command's own attributes in `commands.conf` may override.
 * 45 is the value in SPADS's stock `etc/spads.conf`. Beyond All Reason's
 * `spads_cluster.conf` sets 30. This is the larger of the two. Its
 * `commands_default.conf` is not published, so an override there is unknown.
 */
export const AUTOHOST_VOTE_MS = 45_000;

/** Where a vote stands, from what the host said since the command was sent.
 *  `isCommand` picks out the vote on the command that was sent, so another
 *  player's vote on something else is not taken for it. */
export function voteStateOf(
  lines: string[],
  isCommand: (command: string) => boolean,
): VoteState {
  let state: VoteState = "none";
  for (const line of lines) {
    const called = /called a vote for command "(.*)" \[!vote y/i.exec(line);
    if (called) {
      if (isCommand(called[1])) state = "open";
      continue;
    }
    const ended = /Vote for command "(.*)" (passed|failed)\b/i.exec(line);
    if (ended) {
      if (isCommand(ended[1]))
        state = ended[2].toLowerCase() === "passed" ? "passed" : "failed";
      continue;
    }
    if (state === "open" && /^Vote cancelled by /i.test(line.trim()))
      state = "failed";
  }
  return state;
}

/** The vote on `!set <setting> <value>`. */
export const isSetVote = (setting: string, value: number) => {
  const want = `set ${setting} ${value}`.toLowerCase();
  return (command: string) =>
    command.trim().replace(/\s+/g, " ").toLowerCase() === want;
};

/** The vote on `!map`, which SPADS reads as `set map <name>`. */
export const isMapVote = (command: string) => /^set map /i.test(command.trim());

/** The vote on `!bSet <name> <value>`. The value is left out because a tweak
 *  slot's is 16 KB and the name is what tells one slot from another. */
export const isBSetVote = (name: string) => {
  const head = `bset ${name} `.toLowerCase();
  return (command: string) => command.trim().toLowerCase().startsWith(head);
};
