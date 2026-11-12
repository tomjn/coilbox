/**
 * What a conquest land map stands on its locations besides plain towns, so
 * that no two maps and no two capitals look alike. It is dressing only: a
 * location with a spire, an anomaly or a depot plays as any other.
 *
 * It is dealt from the map alone and never from who is playing, so picking
 * another faction changes nothing that is built.
 */
import type { GalaxyDoc } from "../../model";
import { NEUTRAL } from "../../model";
import type { PlanetId } from "../../planets";
import { hashString, mulberry32, shuffled } from "../../rng";
import { ANOMALY_KINDS, type RunLandmark } from "./kinds";

export interface Dressing {
  /** What stands in place of the town. A capital with none has a stronghold. */
  landmark?: RunLandmark;
}

/** The forms a capital is dealt in turn. No landmark is the stronghold. */
const CAPITAL_FORMS = [undefined, "spire", "landing"] as const;
/** One ordinary location in this many is an anomaly. */
const ANOMALY_EVERY = 8;
/** The share of the other ordinary locations that are depots. */
const DEPOT_SHARE = 0.2;

/** Deal a conquest map's dressing, by location id. */
export function conquestDressing(
  galaxy: Pick<GalaxyDoc, "id" | "nodes">,
  planet: PlanetId | undefined,
): Map<string, Dressing> {
  const out = new Map<string, Dressing>();
  const rng = mulberry32(hashString(galaxy.id));

  // Each held capital takes the next form, so three capitals show all three.
  const forms = shuffled(rng, CAPITAL_FORMS);
  const capitals = galaxy.nodes.filter(
    (n) => n.kind === "capital" && n.owner !== NEUTRAL,
  );
  capitals.forEach((n, k) => {
    const landmark = forms[k % forms.length];
    if (landmark) out.set(n.id, { landmark });
  });

  // A few ordinary locations are an anomaly, each kind once at most. A moon
  // never had a castle, so it is dealt only the kinds that stand there.
  const ordinary = shuffled(
    rng,
    galaxy.nodes.filter((n) => n.kind !== "capital"),
  );
  const kinds = shuffled(
    rng,
    ANOMALY_KINDS.filter((k) => planet !== "moon" || k !== "ruin"),
  );
  const anomalies = Math.min(
    kinds.length,
    Math.floor(ordinary.length / ANOMALY_EVERY),
  );
  for (let k = 0; k < anomalies; k++)
    out.set(ordinary[k].id, { landmark: kinds[k] });

  // Some of the rest are depots, as a run's supply stops are.
  const rest = ordinary.slice(anomalies);
  const depots = Math.round(rest.length * DEPOT_SHARE);
  for (let k = 0; k < depots; k++) out.set(rest[k].id, { landmark: "depot" });
  return out;
}
