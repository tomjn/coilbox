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
 * Every enemy capital gets a stronghold, on a conquest map and on a run's land
 * map alike: a run's boss is a capital held by an enemy. The player's own
 * capital and a neutral one keep their town. A run's start is held by its own
 * faction in the document, not the player's, so it is ruled out by its
 * identity.
 *
 * An anomaly, a depot or a landing pad goes where a run's identities ask for
 * one. A stronghold wins if a location is asked for both, unless what is
 * asked for is a spire, which stands in the stronghold's place and nowhere
 * else.
 */
export function landmarkKinds(
  nodes: Pick<GalaxyNode, "id" | "kind" | "owner">[],
  playerFactionId: string,
  identities?: ReadonlyMap<string, { landmark?: RunLandmark; end?: string }>,
): Map<number, LandmarkKind> {
  const out = new Map<number, LandmarkKind>();
  nodes.forEach((n, i) => {
    const identity = identities?.get(n.id);
    const enemy =
      n.owner !== undefined &&
      n.owner !== playerFactionId &&
      n.owner !== NEUTRAL;
    if (n.kind === "capital" && enemy && identity?.end !== "start")
      out.set(i, identity?.landmark === "spire" ? "spire" : "stronghold");
    else if (identity?.landmark && identity.landmark !== "spire")
      out.set(i, identity.landmark);
  });
  return out;
}
