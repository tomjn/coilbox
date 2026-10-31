import { t } from "@lingui/core/macro";
import { effectiveTeams, type Participant } from "@/play/participants";
import {
  isMapVote,
  isSetVote,
  type VoteState,
  voteStateOf,
} from "./autohostVote";
import {
  AUTOHOST_COMMAND_GAP_MS,
  CONFIRM_POLL_MS,
  confirmTimeoutMs,
  VOTE_WAIT_MS,
} from "./tweakDelivery";

/**
 * The commands a preset sends to an autohost besides its option run: the map and
 * the room's team size and team count (issue #1300). Each is checked against what
 * the room says back, and one that does not take is reported, never retried and
 * never a reason to skip the next.
 *
 * A preset holds participants, not a team size, so the size is derived from them.
 */

/** The two numbers SPADS holds for a room's shape. */
export interface TeamShape {
  /** Teams (engine team ids) per ally team, at most. SPADS's `teamSize`. */
  teamSize: number;
  /** Ally teams. SPADS's `nbTeams`. */
  nbTeams: number;
}

/**
 * The room shape a roster asks for, or null for a roster with nobody playing.
 *
 * `nbTeams` is the number of ally teams and `teamSize` the most engine teams any
 * one of them holds. Engine teams are used rather than rows because rows that
 * share a team slot are one team to SPADS, which counts those with
 * `nbPlayerById` and not here.
 */
export function teamShape(participants: Participant[]): TeamShape | null {
  const { leaderIdByTeam } = effectiveTeams(participants);
  const byId = new Map(participants.map((p) => [p.id, p] as const));
  const perAlly = new Map<number, number>();
  for (const id of leaderIdByTeam) {
    const ally = byId.get(id)?.allyTeam;
    if (ally === undefined) continue;
    perAlly.set(ally, (perAlly.get(ally) ?? 0) + 1);
  }
  if (perAlly.size === 0) return null;
  return { nbTeams: perAlly.size, teamSize: Math.max(...perAlly.values()) };
}

export type HostSetting = "teamSize" | "nbTeams";

export interface HostSteps {
  /** A map to switch to with `!map`. */
  map?: string;
  teamSize?: number;
  nbTeams?: number;
}

export type HostStep = "map" | HostSetting;

export interface HostStepFailure {
  step: HostStep;
  /** Why it did not take, in words for the person who applied the preset. */
  reason: string;
}

export interface HostStepsIo {
  /** Put one chat line to the autohost. */
  send(line: string): Promise<void>;
  /** What the battle's host said from the given time on, in full. */
  hostSaidSince(at: number): string[];
  /** The map the battle is on now. */
  currentMap(): string | undefined;
  /** False once the player has left the room the run began in, or moved to
   *  another. A command sent after that would land in the wrong battle. */
  here(): boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface HostStepsResult {
  failures: HostStepFailure[];
  /** True when the run stopped because the player left the room. */
  left: boolean;
}

/**
 * How the host answered a `!set` of one setting, from its battle chat.
 *
 * SPADS says `Global setting changed by <user> (<name>=<value>)` to the room
 * when it takes one, and `Global setting "<name>" is already set to value
 * "<value>"` when it is already there (`hSet` in `spads.pl`). A change to some
 * other value, such as another boss setting it at the same moment, is reported
 * as what the room holds now.
 */
export function settingAnswer(
  lines: string[],
  setting: HostSetting,
  value: number,
): { took: true } | { took: false; holds: string } | null {
  const want = String(value);
  for (const line of lines) {
    const changed = /Global setting changed by .*\((\w+)=([^)]*)\)/i.exec(line);
    if (changed && changed[1].toLowerCase() === setting.toLowerCase())
      return changed[2] === want
        ? { took: true }
        : { took: false, holds: changed[2] };
    const already =
      /Global setting "(\w+)" is already set to value "([^"]*)"/i.exec(line);
    if (already && already[1].toLowerCase() === setting.toLowerCase())
      return already[2] === want
        ? { took: true }
        : { took: false, holds: already[2] };
  }
  return null;
}

/** What the host said, to quote beside a step that did not take. */
function quoted(lines: string[]): string {
  const first = lines[0];
  if (!first) return t`The room did not answer.`;
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

/** Wait up to `timeout` for `check` to hold. */
async function waitFor(
  io: HostStepsIo,
  timeout: number,
  check: () => boolean,
): Promise<boolean> {
  const startedAt = io.now();
  while (io.here() && io.now() - startedAt < timeout) {
    if (check()) return true;
    await io.sleep(CONFIRM_POLL_MS);
  }
  return check();
}

/**
 * Wait for `check` to hold, for as long as a short command is given to echo, and
 * for as long as SPADS gives a vote when the host answers by calling one.
 *
 * Returns where the vote on the command stands, which is "none" when the host
 * never called one. A vote that passes runs the command at once, so `check` is
 * given a short wait again after it.
 */
async function settle(
  io: HostStepsIo,
  line: string,
  sentAt: number,
  isVote: (command: string) => boolean,
  check: () => boolean,
): Promise<VoteState> {
  const vote = () => voteStateOf(io.hostSaidSince(sentAt), isVote);
  const echoMs = confirmTimeoutMs(line.length, true);
  await waitFor(io, echoMs, () => check() || vote() !== "none");
  if (check() || vote() === "none") return vote();
  if (vote() === "open")
    await waitFor(io, VOTE_WAIT_MS, () => check() || vote() !== "open");
  if (vote() === "passed") await waitFor(io, echoMs, check);
  return vote();
}

/** Why a step with no answer did not take, when a vote is the reason. */
function voteReason(state: VoteState): string | null {
  if (state === "failed") return t`The room's vote on it did not pass.`;
  if (state === "open") {
    const seconds = Math.round(VOTE_WAIT_MS / 1000);
    return t`The room's vote on it was still open after ${seconds}s.`;
  }
  return null;
}

/**
 * Send each step to the autohost and say which did not take.
 *
 * Steps go one at a time, at the gap an autohost needs between commands (see
 * `AUTOHOST_COMMAND_GAP_MS`), and the wait for each answer is the one a short
 * `!bSet` already gets from `confirmTimeoutMs`. When the host answers by calling
 * a vote (`autohostVote.ts`), the step waits for the vote's result instead, and
 * a vote that fails is reported as that and not as a refusal. A step that fails
 * is recorded and the next still goes, because refusing one setting says nothing
 * about the others.
 */
export async function runHostSteps(
  steps: HostSteps,
  io: HostStepsIo,
): Promise<HostStepsResult> {
  const failures: HostStepFailure[] = [];
  const stopped = (): HostStepsResult => ({ failures, left: true });

  const pace = async (sentAt: number) => {
    const owed = AUTOHOST_COMMAND_GAP_MS - (io.now() - sentAt);
    if (owed > 0) await io.sleep(owed);
  };

  if (steps.map) {
    const want = steps.map.toLowerCase();
    const line = `!map ${steps.map}`;
    if (!io.here()) return stopped();
    const sentAt = io.now();
    await io.send(line);
    const landed = () => io.currentMap()?.toLowerCase() === want;
    const vote = await settle(io, line, sentAt, isMapVote, landed);
    if (!io.here()) return stopped();
    if (!landed())
      failures.push({
        step: "map",
        reason: voteReason(vote) ?? quoted(io.hostSaidSince(sentAt)),
      });
    await pace(sentAt);
  }

  for (const setting of ["teamSize", "nbTeams"] as const) {
    const value = steps[setting];
    if (value === undefined) continue;
    const line = `!set ${setting} ${value}`;
    if (!io.here()) return stopped();
    const sentAt = io.now();
    await io.send(line);
    const read = () => settingAnswer(io.hostSaidSince(sentAt), setting, value);
    const vote = await settle(
      io,
      line,
      sentAt,
      isSetVote(setting, value),
      () => read() !== null,
    );
    if (!io.here()) return stopped();
    const answer = read();
    if (answer === null) {
      failures.push({
        step: setting,
        reason: voteReason(vote) ?? quoted(io.hostSaidSince(sentAt)),
      });
    } else if (!answer.took) {
      const holds = answer.holds;
      failures.push({
        step: setting,
        reason: t`The room is set to ${holds}.`,
      });
    }
    await pace(sentAt);
  }

  return io.here() ? { failures, left: false } : stopped();
}
