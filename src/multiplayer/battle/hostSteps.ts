import { t } from "@lingui/core/macro";
import { effectiveTeams, type Participant } from "@/play/participants";
import {
  AUTOHOST_COMMAND_GAP_MS,
  CONFIRM_POLL_MS,
  confirmTimeoutMs,
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
  sleep(ms: number): Promise<void>;
  now(): number;
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

/** Wait for `check` to hold, for as long as a short command is given to echo. */
async function until(
  io: HostStepsIo,
  line: string,
  check: () => boolean,
): Promise<boolean> {
  const timeout = confirmTimeoutMs(line.length, true);
  const startedAt = io.now();
  while (io.now() - startedAt < timeout) {
    if (check()) return true;
    await io.sleep(CONFIRM_POLL_MS);
  }
  return check();
}

/**
 * Send each step to the autohost and say which did not take.
 *
 * Steps go one at a time, at the gap an autohost needs between commands (see
 * `AUTOHOST_COMMAND_GAP_MS`), and the wait for each answer is the one a short
 * `!bSet` already gets from `confirmTimeoutMs`. A step that fails is recorded
 * and the next still goes, because refusing one setting says nothing about the
 * others.
 */
export async function runHostSteps(
  steps: HostSteps,
  io: HostStepsIo,
): Promise<HostStepFailure[]> {
  const failures: HostStepFailure[] = [];

  const pace = async (sentAt: number) => {
    const owed = AUTOHOST_COMMAND_GAP_MS - (io.now() - sentAt);
    if (owed > 0) await io.sleep(owed);
  };

  if (steps.map) {
    const want = steps.map.toLowerCase();
    const line = `!map ${steps.map}`;
    const sentAt = io.now();
    await io.send(line);
    const landed = await until(
      io,
      line,
      () => io.currentMap()?.toLowerCase() === want,
    );
    if (!landed)
      failures.push({ step: "map", reason: quoted(io.hostSaidSince(sentAt)) });
    await pace(sentAt);
  }

  for (const setting of ["teamSize", "nbTeams"] as const) {
    const value = steps[setting];
    if (value === undefined) continue;
    const line = `!set ${setting} ${value}`;
    const sentAt = io.now();
    await io.send(line);
    const read = () => settingAnswer(io.hostSaidSince(sentAt), setting, value);
    await until(io, line, () => read() !== null);
    const answer = read();
    if (answer === null) {
      failures.push({
        step: setting,
        reason: quoted(io.hostSaidSince(sentAt)),
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

  return failures;
}
