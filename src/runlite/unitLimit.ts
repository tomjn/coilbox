import type { UnitDatasetEntry } from "../content/bindings";
import { buildEdgeMap, reachableFrom } from "../content/buildTree";
import type { UnitsyncInfoStatus } from "../content/config";
import { morphEdgeMap } from "../content/morphGraph";
import { disabledUnitsFor } from "./build";
import type { GenBuildGraph } from "./generate";
import type { RogueliteRun } from "./model";

/**
 * Whether coilbox can work out a warpath's unit limit, and what it does when it
 * cannot (issue #3473).
 *
 * The limit covers the units reachable from the start unit through build
 * options. That is the same graph the unlock rewards are drawn from, so every
 * unit a reward can offer is a unit the limit understands. Units reached only
 * by morphing are limited too (issue #3487), but no reward offers them, so they
 * open up with the unit that morphs into them rather than needing an unlock of
 * their own. See `disabledUnitsFor`. A unit no route reaches is never
 * disabled, which is harmless: nothing the player owns can build it.
 */

/** Why coilbox cannot work out a limit for a start unit. */
export type NoLimitReason =
  | "no-start-unit"
  | "start-unit-not-in-data"
  | "reaches-nothing";

/** What a run's unit limit is, once the game's unit data has been read. */
export type UnitLimit =
  | { kind: "limited"; disabled: string[] }
  | { kind: "none"; reason: NoLimitReason };

/** Whether a launch can go ahead, and with what limit. */
export type LimitReadiness =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; limit: UnitLimit };

/**
 * Why a start unit gives no limit over `edges`, or null when it does. A start
 * unit that is in the data but builds nothing reaches only itself.
 */
export function noLimitReason(
  startUnit: string | undefined,
  edges: Map<string, string[]>,
): NoLimitReason | null {
  if (!startUnit) return "no-start-unit";
  if (!edges.has(startUnit.toLowerCase())) return "start-unit-not-in-data";
  return reachableFrom(startUnit, edges).size > 1 ? null : "reaches-nothing";
}

/** The units a run starts from, and whether coilbox worked them out itself. */
export interface StartSet {
  roots: string[];
  derived: boolean;
}

/**
 * The units a run starts from.
 *
 * A start unit that is in the unit data and builds something is the start set
 * by itself. Otherwise the side names no usable start unit, as Zero-K's
 * `update_your_damn_engine` placeholder (the game spawns commanders from Lua),
 * and Random sides do. The set is then read from the unit data: every mobile
 * unit that has build options and that no unit builds or morphs into. That is
 * what a commander looks like in the data, and a Random side gets the
 * commanders of every real side. It is kept only when it reaches units beyond
 * itself, so a game it does not fit still gets the "no limit" warning.
 */
export function startSetFor(
  startUnit: string | undefined,
  units: UnitDatasetEntry[],
): StartSet {
  if (!startUnit) return { roots: [], derived: false };
  const edges = buildEdgeMap(units);
  if (noLimitReason(startUnit, edges) === null) {
    return { roots: [startUnit.toLowerCase()], derived: false };
  }
  const morphs = morphEdgeMap(units);
  const taken = new Set<string>();
  for (const options of edges.values()) {
    for (const option of options) taken.add(option);
  }
  for (const [from, targets] of morphs) {
    for (const to of targets) if (to !== from) taken.add(to);
  }
  const roots = units
    .filter(
      (u) =>
        u.mobile === true &&
        !taken.has(u.name.toLowerCase()) &&
        (edges.get(u.name.toLowerCase()) ?? []).some((o) => edges.has(o)),
    )
    .map((u) => u.name.toLowerCase())
    .sort();
  const reach = reachableFromAll(roots, edges);
  return roots.length > 0 && reach.size > roots.length
    ? { roots, derived: true }
    : { roots: [], derived: false };
}

/** The units reachable from any of `roots` through build options. */
export function reachableFromAll(
  roots: string[],
  edges: Map<string, string[]>,
): Set<string> {
  const reach = new Set<string>();
  for (const root of roots) {
    for (const unit of reachableFrom(root, edges)) reach.add(unit);
  }
  return reach;
}

/**
 * The build graph the unlock rewards are drawn from, or undefined when there is
 * no start unit. A derived start set rides along as `roots`.
 */
export function buildGraphFor(
  startUnit: string | undefined,
  units: UnitDatasetEntry[],
): GenBuildGraph | undefined {
  if (!startUnit) return undefined;
  const set = startSetFor(startUnit, units);
  const names = new Map<string, string>();
  for (const u of units) names.set(u.name.toLowerCase(), u.fullName ?? u.name);
  return {
    startUnit: startUnit.toLowerCase(),
    ...(set.derived ? { roots: set.roots } : {}),
    edges: buildEdgeMap(units),
    names,
  };
}

/** The limit for `run` over a game's build edges. */
export function unitLimitFor(
  run: RogueliteRun,
  edges: Map<string, string[]>,
  morphEdges: Map<string, string[]>,
  derivedRoots?: string[],
): UnitLimit {
  if (derivedRoots && derivedRoots.length > 0) {
    return {
      kind: "limited",
      disabled: disabledUnitsFor(run, edges, morphEdges, derivedRoots),
    };
  }
  const reason = noLimitReason(run.startUnit, edges);
  return reason
    ? { kind: "none", reason }
    : { kind: "limited", disabled: disabledUnitsFor(run, edges, morphEdges) };
}

/**
 * Whether the launch has what it needs to know the limit. A run with no start
 * unit needs no unit data. Otherwise the data must have loaded: while it loads
 * the launch waits, and when it failed the limit is unknown, which is not the
 * same as there being nothing to disable.
 */
export function limitReadiness(
  run: RogueliteRun,
  data: { status: UnitsyncInfoStatus; units?: UnitDatasetEntry[] },
): LimitReadiness {
  if (!run.startUnit) {
    return { kind: "ready", limit: { kind: "none", reason: "no-start-unit" } };
  }
  if (data.status === "idle" || data.status === "loading") {
    return { kind: "loading" };
  }
  if (data.status === "error" || !data.units) return { kind: "failed" };
  const set = startSetFor(run.startUnit, data.units);
  return {
    kind: "ready",
    limit: unitLimitFor(
      run,
      buildEdgeMap(data.units),
      morphEdgeMap(data.units),
      set.derived ? set.roots : undefined,
    ),
  };
}

/** What the briefing tells the player when a run has no unit limit. */
export function noLimitMessage(
  reason: NoLimitReason,
  startUnit: string | undefined,
  gameName: string,
): string {
  const tail = "so coilbox cannot limit your units. Every unit is available.";
  switch (reason) {
    case "no-start-unit":
      return `This run has no start unit, ${tail}`;
    case "start-unit-not-in-data":
      return `${startUnit}, this run's start unit, is not one of the units in ${gameName}, ${tail}`;
    case "reaches-nothing":
      return `Nothing can be built from ${startUnit}, this run's start unit, ${tail}`;
  }
}

/** What the launch button shows while the limit is not known, or null once it is. */
export function limitHold(
  readiness: LimitReadiness,
): { label: string; busy: boolean; error?: string } | null {
  switch (readiness.kind) {
    case "loading":
      return { label: "Loading unit data…", busy: true, error: undefined };
    case "failed":
      return {
        label: "Cannot launch without unit data",
        busy: false,
        error:
          "Coilbox could not read this game's unit data, so it cannot work out your unit limit. The battle will not launch until it can.",
      };
    case "ready":
      return null;
  }
}

/**
 * What the setup screen says before a run starts when its side gives no limit,
 * or null when it does or the unit data is still loading. The player decides
 * whether to begin.
 */
export function setupLimitWarning(input: {
  gameName: string;
  sideName: string;
  startUnit?: string;
  status: UnitsyncInfoStatus;
  units?: UnitDatasetEntry[];
}): string | null {
  const { gameName, sideName, startUnit, status, units } = input;
  const tail =
    "so coilbox cannot limit your units. Rewards will offer perks only and every unit will be available from the first battle.";
  if (status === "error" || (status === "ready" && !units)) {
    return "Coilbox could not read this game's unit data, so it cannot limit your units. Rewards will offer perks only and every unit will be available from the first battle.";
  }
  if (status !== "ready" && status !== "unsyncable") return null;
  if (!startUnit)
    return `${sideName} has no start unit in ${gameName}, ${tail}`;
  if (startSetFor(startUnit, units ?? []).derived) return null;
  const reason = noLimitReason(startUnit, buildEdgeMap(units ?? []));
  if (reason === "start-unit-not-in-data") {
    return `The start unit for ${sideName}, ${startUnit}, is not one of the units in ${gameName}, ${tail}`;
  }
  if (reason === "reaches-nothing") {
    return `Nothing can be built from ${startUnit}, the start unit for ${sideName}, ${tail}`;
  }
  return null;
}

/**
 * The one line the setup screen shows when the limit rests on a start set that
 * coilbox derived from the unit data, or null when the side's own start unit
 * gives the limit or there is no limit.
 */
export function setupLimitNote(input: {
  gameName: string;
  sideName: string;
  startUnit?: string;
  status: UnitsyncInfoStatus;
  units?: UnitDatasetEntry[];
}): string | null {
  const { gameName, sideName, startUnit, status, units } = input;
  if ((status !== "ready" && status !== "unsyncable") || !units) return null;
  const set = startSetFor(startUnit, units);
  if (!set.derived) return null;
  return `${sideName} has no usable start unit in ${gameName}, so the unit limit is based on the ${set.roots.length} mobile units that can build and that no other unit builds or morphs into.`;
}
