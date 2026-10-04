import type { UnitDatasetEntry } from "../content/bindings";
import { buildEdgeMap, reachableFrom } from "../content/buildTree";
import type { UnitsyncInfoStatus } from "../content/config";
import { disabledUnitsFor } from "./build";
import type { RogueliteRun } from "./model";

/**
 * Whether coilbox can work out a warpath's unit limit, and what it does when it
 * cannot (issue #3473).
 *
 * The limit covers the units reachable from the start unit through build
 * options. That is the same graph the unlock rewards are drawn from, so every
 * unit a reward can offer is a unit the limit understands. Morph edges are left
 * out on purpose. A morph form such as `claw_u1commander` is not something a
 * reward can unlock, so disabling it would lock the player out of their
 * commander's upgrade for good. A unit no route reaches is never disabled,
 * which is harmless: nothing the player owns can build it.
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

/** The limit for `run` over a game's build edges. */
export function unitLimitFor(
  run: RogueliteRun,
  edges: Map<string, string[]>,
): UnitLimit {
  const reason = noLimitReason(run.startUnit, edges);
  return reason
    ? { kind: "none", reason }
    : { kind: "limited", disabled: disabledUnitsFor(run, edges) };
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
  return {
    kind: "ready",
    limit: unitLimitFor(run, buildEdgeMap(data.units)),
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
