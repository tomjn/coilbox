import type { RuntimeMarker } from "./bindings";

/**
 * What installing the mission runtime into a game would do, from the marker the
 * game has and the one this build of coilbox ships.
 *
 * - `unavailable`: coilbox has no runtime to install (a build with the resource
 *   missing). There is nothing to offer.
 * - `missing`: the game has not adopted the runtime.
 * - `outdated`: the game vendored an older runtime, so installing updates it.
 * - `current`: the game is in step. Installing again is still allowed, because
 *   the files live in the game's own folder where anything can happen to them.
 * - `newer`: the game vendored a runtime this coilbox does not know about.
 *   Installing would take it backwards, so the UI says so first.
 */
export type RuntimeInstallState =
  | "unavailable"
  | "missing"
  | "outdated"
  | "current"
  | "newer";

export function runtimeInstallState(
  installed: RuntimeMarker | null,
  available: RuntimeMarker | null,
): RuntimeInstallState {
  if (!available) return "unavailable";
  if (!installed) return "missing";
  if (installed.version < available.version) return "outdated";
  if (installed.version > available.version) return "newer";
  return "current";
}
