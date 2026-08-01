/**
 * What each participant starts a mission with: the document's `teams` block.
 *
 * A `teams` entry is the only part of a scenario the skirmish setup cannot
 * express, and the only part a vendoring game is asked a question about. Three
 * of its four fields are economy, and the fourth is the contract:
 *
 * - `startUnits` are handed to the team on its engine start position, so an
 *   opening force arrives where the team spawns rather than where the author
 *   clicked. That is the difference between this and a group.
 * - `resources` is the bank the mission opens on. The runtime sets it for every
 *   team the scenario declares, so a team with no number set opens on nothing
 *   rather than on whatever the game hands out.
 * - `income` is free metal and energy per second, added on top of anything the
 *   team builds.
 * - `noCommander` is what `GG.CoilboxMission.suppressesStart(teamID)` answers,
 *   and every entry marked with it is what `suppressesEveryStart()` counts. A
 *   game that adopted the runtime spawns nothing for a suppressed team, and one
 *   that has not had its start removed for it up to the end of game frame 1.
 *
 * That second question is why {@link everyStartSuppressed} exists. A game whose
 * start is a sequence of pre-game phases (a faction picker, a start spot picker)
 * skips the whole sequence only when the mission owns *every* engine team's
 * start, so marking the player and not the enemy leaves the pickers running over
 * a mission that is already playing.
 *
 * Arithmetic on plain values, so it can be tested without a browser. The panel
 * that shows it is the start conditions section of `SetupPanel.tsx`.
 */

import { effectiveTeams, type Participant } from "@/play/participants";
import type { Scenario, ScenarioTeam } from "../../model";

/** The most of one unit type a team can be given to start with. Not the
 *  engine's limit: it is what still reads as an opening force rather than as an
 *  army the mission should be placing as a group. */
export const MAX_START_UNITS = 50;

/** The most metal or energy a bank or an income can be set to. Ten million is
 *  past any mission's economy and short of the float precision where the
 *  engine's own resource display starts rounding. */
export const MAX_AMOUNT = 10_000_000;

/** One unit type in a team's start units, and how many of it. */
export interface StartUnit {
  def: string;
  count: number;
}

/** Which pair of numbers is being set: the opening bank, or the free trickle. */
export type AmountField = "resources" | "income";
export type Amount = "metal" | "energy";

/** A participant's entry, or an empty one when the author has set nothing. */
export function teamOf(scenario: Scenario, id: string): ScenarioTeam {
  return scenario.teams[id] ?? {};
}

/** True when an entry asks for nothing, and so is worth no space in the
 *  document. Read field by field rather than by counting keys, because a
 *  `resources` of `{}` and a `noCommander` of false both say nothing. */
function saysNothing(team: ScenarioTeam): boolean {
  return (
    (team.startUnits?.length ?? 0) === 0 &&
    team.resources?.metal === undefined &&
    team.resources?.energy === undefined &&
    team.income?.metal === undefined &&
    team.income?.energy === undefined &&
    team.noCommander !== true
  );
}

/**
 * The document with one participant's entry rewritten, and the entry dropped
 * when it has come to say nothing.
 *
 * Dropping matters beyond tidiness: `participantHoldings` reports a `teams`
 * entry as something a participant owns, and an entry left behind empty would
 * make removing that participant ask a question with no answer worth giving.
 */
function writeTeam(
  scenario: Scenario,
  id: string,
  team: ScenarioTeam,
): Scenario {
  const teams = { ...scenario.teams };
  if (saysNothing(team)) {
    if (!(id in scenario.teams)) return scenario;
    delete teams[id];
  } else {
    teams[id] = team;
  }
  return { ...scenario, teams };
}

/* -------------------------------------------------------------------------- *
 * Start units.
 *
 * The document holds a flat list of unit defs, because the runtime lays them out
 * one per grid cell. An author counts instead ("three A.K.s and a Lifter"), so
 * the list is read as counts and written back expanded, in the order the defs
 * were first added. Order is not meaningful to the runtime beyond which cell of
 * the grid a unit lands in.
 * -------------------------------------------------------------------------- */

/** A team's start units as counts by def, in first-appearance order. */
export function startUnits(team: ScenarioTeam): StartUnit[] {
  const counts: StartUnit[] = [];
  const at = new Map<string, number>();
  for (const def of team.startUnits ?? []) {
    const index = at.get(def);
    if (index === undefined) {
      at.set(def, counts.length);
      counts.push({ def, count: 1 });
    } else {
      counts[index].count++;
    }
  }
  return counts;
}

/** How many units a team is handed at its start position. */
export function startUnitTotal(team: ScenarioTeam): number {
  return team.startUnits?.length ?? 0;
}

/**
 * Every unit def any team starts with, once each.
 *
 * A start unit is a unit the scenario places, but it has no position, so it is
 * not a {@link scenarioPlacements} placement and nothing that reads defs off the
 * map can see it. Changing the game has to, or an author swapping games is told
 * their scenario places nothing while a team still starts with three units the
 * new game has never heard of.
 */
export function startUnitDefs(scenario: Scenario): string[] {
  const defs = new Set<string>();
  for (const team of Object.values(scenario.teams)) {
    for (const def of team.startUnits ?? []) defs.add(def);
  }
  return [...defs];
}

/** A count held to something a start position has room for. */
export function clampStartCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(MAX_START_UNITS, Math.max(1, Math.trunc(count)));
}

/** The list expanded back out, dropping anything counted to nothing. */
function expand(counts: StartUnit[]): string[] {
  const out: string[] = [];
  for (const { def, count } of counts) {
    for (let n = 0; n < count; n++) out.push(def);
  }
  return out;
}

/** The document with a team's start units set from counts by def. */
function writeStartUnits(
  scenario: Scenario,
  id: string,
  counts: StartUnit[],
): Scenario {
  const team = { ...teamOf(scenario, id) };
  const defs = expand(counts);
  if (defs.length === 0) delete team.startUnits;
  else team.startUnits = defs;
  return writeTeam(scenario, id, team);
}

/**
 * One more of a unit type in a team's start units. A def the team already
 * starts with is one more of it rather than a second entry, so the list stays as
 * short as the force is varied.
 */
export function addStartUnit(
  scenario: Scenario,
  id: string,
  def: string,
): Scenario {
  const wanted = def.trim();
  if (!wanted) return scenario;
  const counts = startUnits(teamOf(scenario, id));
  const at = counts.findIndex((entry) => entry.def === wanted);
  if (at < 0)
    return writeStartUnits(scenario, id, [
      ...counts,
      { def: wanted, count: 1 },
    ]);
  if (counts[at].count >= MAX_START_UNITS) return scenario;
  const next = counts.slice();
  next[at] = { def: wanted, count: counts[at].count + 1 };
  return writeStartUnits(scenario, id, next);
}

/** How many of one unit type a team starts with. A count of zero takes the def
 *  off the list, which is what emptying the box means. */
export function setStartUnitCount(
  scenario: Scenario,
  id: string,
  def: string,
  count: number,
): Scenario {
  const counts = startUnits(teamOf(scenario, id));
  const at = counts.findIndex((entry) => entry.def === def);
  if (at < 0) return scenario;
  if (count < 1) {
    return writeStartUnits(
      scenario,
      id,
      counts.filter((_, i) => i !== at),
    );
  }
  const next = counts.slice();
  next[at] = { def, count: clampStartCount(count) };
  return writeStartUnits(scenario, id, next);
}

/** A unit type off a team's start units entirely. */
export function removeStartUnit(
  scenario: Scenario,
  id: string,
  def: string,
): Scenario {
  return setStartUnitCount(scenario, id, def, 0);
}

/* -------------------------------------------------------------------------- *
 * Resources and income.
 * -------------------------------------------------------------------------- */

/** An amount held to a number the engine can hold and an author meant. */
export function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_AMOUNT, Math.max(0, Math.round(value)));
}

/**
 * One of the four numbers set, or cleared with `null`.
 *
 * Clearing is not the same as zero for `income`, which the runtime skips
 * entirely when it is absent, and it is the same for `resources`, which the
 * runtime reads as nothing either way. Both are stored the way they were asked
 * for, so a document says what its author set rather than what happens to have
 * the same effect.
 */
export function setTeamAmount(
  scenario: Scenario,
  id: string,
  field: AmountField,
  which: Amount,
  value: number | null,
): Scenario {
  const team = { ...teamOf(scenario, id) };
  const pair: { metal?: number; energy?: number } = { ...team[field] };
  if (value === null) delete pair[which];
  else pair[which] = clampAmount(value);
  if (pair.metal === undefined && pair.energy === undefined) delete team[field];
  else team[field] = pair;
  return writeTeam(scenario, id, team);
}

/* -------------------------------------------------------------------------- *
 * The commander, which is the adoption contract's question.
 * -------------------------------------------------------------------------- */

/** Whether the mission owns this participant's start. */
export function setTeamNoCommander(
  scenario: Scenario,
  id: string,
  on: boolean,
): Scenario {
  const team = { ...teamOf(scenario, id) };
  if (on) team.noCommander = true;
  else delete team.noCommander;
  return writeTeam(scenario, id, team);
}

/**
 * Every engine team the setup produces, and whether the mission owns its start.
 *
 * Keyed by engine team number rather than by participant, because that is what
 * the runtime answers on: two participants sharing a team slot share one engine
 * team, and one of them marking `noCommander` suppresses that team's start for
 * both. A participant with no engine team number is a spectator and has no start
 * to suppress.
 */
export function engineStarts(
  scenario: Scenario,
): { team: number; suppressed: boolean }[] {
  const raw = (scenario.setup as { participants?: unknown }).participants;
  const participants = (Array.isArray(raw) ? raw : []) as Participant[];
  const { teamIndexById } = effectiveTeams(participants);

  const suppressed = new Map<number, boolean>();
  for (const participant of participants) {
    const team = teamIndexById.get(participant.id);
    if (team === undefined) continue;
    const owned = scenario.teams[participant.id]?.noCommander === true;
    suppressed.set(team, (suppressed.get(team) ?? false) || owned);
  }
  return [...suppressed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([team, owned]) => ({ team, suppressed: owned }));
}

/**
 * What `GG.CoilboxMission.suppressesEveryStart()` will answer, computed the same
 * way: true only when every engine team the setup produces has its start owned
 * by the mission.
 *
 * False for a setup with no engine teams at all, because a mission that declares
 * nothing owns nothing. The runtime's own loop returns true over an empty team
 * list, but the engine never hands it one.
 */
export function everyStartSuppressed(scenario: Scenario): boolean {
  const starts = engineStarts(scenario);
  return starts.length > 0 && starts.every((s) => s.suppressed);
}

/**
 * What is wrong with the starts as they stand, in the words the panel shows, or
 * null.
 *
 * The one that matters is a partly-suppressed setup. A game whose start is a
 * sequence of pre-game phases asks `suppressesEveryStart()` at the top of it, so
 * leaving one team unmarked runs the whole sequence: on Splinter Faction that is
 * a faction picker and a start spot picker over a mission that is already
 * playing, and a commander for every team a minute in.
 */
export function startsWarning(scenario: Scenario): string | null {
  const starts = engineStarts(scenario);
  const marked = starts.filter((s) => s.suppressed).length;
  if (marked === 0 || marked === starts.length) return null;
  const left = starts.length - marked;
  return `${left} of ${starts.length} teams still take the game's own start. A game whose start is a sequence of pre-game phases, a faction picker or a start spot picker, runs the whole sequence unless the mission owns every team's start, so those phases will play over this mission. Mark every team, or none.`;
}

/** What the start conditions come to, for a shut panel's one line. */
export function startsSummary(scenario: Scenario): string {
  const entries = Object.values(scenario.teams);
  if (entries.length === 0) return "The game's own start";
  const units = entries.reduce((sum, team) => sum + startUnitTotal(team), 0);
  const parts: string[] = [];
  if (units > 0) parts.push(`${units} start unit${units === 1 ? "" : "s"}`);
  const banked = entries.filter((t) => t.resources).length;
  if (banked > 0) parts.push(`${banked} banked`);
  const paid = entries.filter((t) => t.income).length;
  if (paid > 0) parts.push(`${paid} on income`);
  const suppressed = entries.filter((t) => t.noCommander).length;
  if (suppressed > 0) parts.push(`${suppressed} without a commander`);
  return parts.length === 0 ? "The game's own start" : parts.join(" · ");
}
