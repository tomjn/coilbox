import type { RuntimeMarker } from "./bindings";

/**
 * Where one condition or action type stands, given the runtime a game has
 * vendored and the one this build of coilbox ships.
 *
 * - `supported`: the installed runtime implements it, so a scenario using it
 *   will run in this game.
 * - `added`: coilbox's runtime declares it and the installed one does not.
 *   Installing or updating the runtime is what adds it.
 * - `extra`: the installed runtime declares it and coilbox's does not. The game
 *   vendored a newer runtime than this coilbox knows about, so coilbox has
 *   nothing to offer for the type even though the game can run it.
 */
export type CapabilityStatus = "supported" | "added" | "extra";

/** One condition or action type, and where it stands. */
export interface Capability {
  name: string;
  status: CapabilityStatus;
}

/** Every condition and action type either runtime declares, sorted by name. */
export interface RuntimeCapabilities {
  conditions: Capability[];
  actions: Capability[];
}

function classify(
  installedTypes: string[] | undefined,
  availableTypes: string[] | undefined,
): Capability[] {
  const installed = new Set(installedTypes ?? []);
  const available = new Set(availableTypes ?? []);
  const names = [...new Set([...installed, ...available])].sort();
  const status = (name: string): CapabilityStatus => {
    if (!installed.has(name)) return "added";
    if (availableTypes && !available.has(name)) return "extra";
    return "supported";
  };
  return names.map((name) => ({ name, status: status(name) }));
}

/**
 * What the runtime installed in a game supports, against what coilbox ships.
 *
 * Neither list is assumed to contain the other. A game can vendor an older
 * runtime that lacks types coilbox knows, or a newer one that declares types it
 * does not. Both show up in the returned lists, with the status that says which
 * way round it is.
 *
 * With no marker installed every type is `added`, which is what installing the
 * runtime would give the game. With no marker available (a coilbox build
 * missing its runtime resource) there is nothing to compare against, so the
 * installed types are reported as `supported` rather than guessed at.
 */
export function runtimeCapabilities(
  installed: RuntimeMarker | null,
  available: RuntimeMarker | null,
): RuntimeCapabilities {
  return {
    conditions: classify(installed?.conditions, available?.conditions),
    actions: classify(installed?.actions, available?.actions),
  };
}

/**
 * How many of `items` the installed runtime implements. Extras count: the game
 * can run them, even though coilbox's editor has nothing to offer for them.
 */
export function supportedCount(items: Capability[]): number {
  return items.filter((c) => c.status !== "added").length;
}
