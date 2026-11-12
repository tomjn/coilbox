import { type GalaxyNode, NEUTRAL } from "../../model";

/**
 * What a run's anomaly can be. Each is one of a kind: a map holds at most one
 * of each.
 */
export const ANOMALY_KINDS = [
  "ruin",
  "monolith",
  "shard",
  "gate",
  "overhang",
  "stump",
  "sphere",
] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

/**
 * What a run can ask to stand on one of its stops: an anomaly, a depot on a
 * supply stop, the landing pad on its start, or a spire in place of the
 * stronghold on its last.
 */
export type RunLandmark = AnomalyKind | "depot" | "landing" | "spire";

/** What stands on a location in place of its town. */
export type LandmarkKind = "stronghold" | RunLandmark;

/**
 * Which locations get a landmark, by index into `nodes`.
 *
 * Every capital a faction holds gets a stronghold, on a conquest map and on a
 * run's land map alike: a run's boss is a capital held by an enemy. Whose it
 * is makes no difference, so the player's own capital has one too and nothing
 * changes when the player picks another faction. A neutral capital keeps its
 * town, and a run's start is ruled out by its identity.
 *
 * A spire or a landing pad stands in the stronghold's place where the
 * identities ask for one. A spire stands nowhere else. An anomaly, a depot or
 * a landing pad goes where the identities ask for one, and a stronghold wins
 * if a capital is asked for an anomaly or a depot.
 */
export function landmarkKinds(
  nodes: Pick<GalaxyNode, "id" | "kind" | "owner">[],
  identities?: ReadonlyMap<string, { landmark?: RunLandmark; end?: string }>,
): Map<number, LandmarkKind> {
  const out = new Map<number, LandmarkKind>();
  nodes.forEach((n, i) => {
    const identity = identities?.get(n.id);
    const held = n.owner !== undefined && n.owner !== NEUTRAL;
    const asked = identity?.landmark;
    if (n.kind === "capital" && held && identity?.end !== "start")
      out.set(
        i,
        asked === "spire" || asked === "landing" ? asked : "stronghold",
      );
    else if (identity?.landmark && identity.landmark !== "spire")
      out.set(i, identity.landmark);
  });
  return out;
}
