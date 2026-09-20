import type { PlayTarget } from "../../play/config";

/**
 * Whether the engine this machine would launch is the one the host asked for.
 *
 * The engine refuses a connection from any other version ("Wrong network
 * version"), and says so only in the host's log, so the player needs both
 * versions in front of them before the game starts.
 *
 * - `match` and `mismatch` compare the host's version with the one our engine
 *   binary reported.
 * - `unverified` is an engine nobody has run yet, which only has its folder
 *   name. A folder name that differs proves nothing, so it is not a mismatch.
 * - `unknown` is a lobby that never gave the host's version.
 * - `none` is no engine on this machine at all.
 */
export type EngineVerdict =
  | "match"
  | "mismatch"
  | "unverified"
  | "unknown"
  | "none";

export interface EngineMatch {
  verdict: EngineVerdict;
  /** The host's engine as the lobby gave it, e.g. `Recoil 2026.03.01`. */
  hostLabel: string | null;
  /** The engine this machine would launch. */
  mineLabel: string | null;
}

export function engineMatch(
  host: { engine: string; version: string },
  target: Pick<PlayTarget, "engineVersion" | "syncVersion"> | null | undefined,
): EngineMatch {
  const hostVersion = host.version.trim();
  const hostLabel =
    hostVersion === "" ? null : `${host.engine.trim()} ${hostVersion}`.trim();
  if (!target) return { verdict: "none", hostLabel, mineLabel: null };

  const mine = (target.syncVersion ?? target.engineVersion).trim();
  let verdict: EngineVerdict;
  if (hostVersion === "") verdict = "unknown";
  else if (mine === hostVersion) verdict = "match";
  else verdict = target.syncVersion ? "mismatch" : "unverified";
  return { verdict, hostLabel, mineLabel: mine };
}
