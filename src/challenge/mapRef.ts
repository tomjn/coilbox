import type { GalaxyDoc } from "../conquest/model";

/**
 * How a challenge names the hand-made map it is played on (issue #3512). A
 * hand-made map cannot be rebuilt from settings and its images are far too
 * large for a code, so the code names the map and the player needs their own
 * copy.
 *
 * Both modes write the same shape: Conquest as `settings.map`, and Warpath as
 * the run's own `settings.map`, which it already stored. Every part beside the
 * id is optional, so a payload from before the fingerprint still reads. It is
 * an addition to the challenge payload and does not move `kindVersion`.
 */
export interface HandmadeMapRef {
  source: "handmade";
  /** The map's id in the hand-made map library. */
  id: string;
  /**
   * Which version of the map the challenge was made on (see
   * `../conquest/handmade/fingerprint`). Absent on a Warpath code written
   * before fingerprints, which any version of the map satisfies.
   */
  fingerprint?: string;
  /**
   * The map's title when the challenge was made. Carried so a player without
   * the map can be told its name, which is what they would look for. It is a
   * label and no part of the challenge's identity.
   */
  title?: string;
}

/** Read a hand-made map reference from untrusted input, or null. */
export function parseHandmadeMapRef(value: unknown): HandmadeMapRef | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.source !== "handmade") return null;
  if (typeof v.id !== "string" || v.id === "") return null;
  const title = typeof v.title === "string" ? v.title.trim() : "";
  return {
    source: "handmade",
    id: v.id,
    ...(typeof v.fingerprint === "string" && v.fingerprint !== ""
      ? { fingerprint: v.fingerprint }
      : {}),
    ...(title !== "" ? { title } : {}),
  };
}

/** The reference to write for a map as its reader gave it. */
export function handmadeMapRefFor(map: GalaxyDoc): HandmadeMapRef {
  const fingerprint = map.handmade?.fingerprint;
  return {
    source: "handmade",
    id: map.handmade?.mapId ?? map.id,
    ...(fingerprint ? { fingerprint, title: map.title } : {}),
  };
}
