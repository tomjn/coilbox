/**
 * The per-game Terrain changes switch (issue #4792).
 *
 * Whether a game can change the ground is detected from its units, by
 * `terrainSupport` in `./units.ts`. Detection sets the default and this store
 * holds the person's override, so a game built on Zero-K's code that renamed
 * `terraunit` can be switched on and a game that has it can be switched off.
 *
 * Kept the way `./equivalentsStore.ts` keeps its tables: in this machine's
 * storage, keyed by the game's shortname so an update does not lose it. Only
 * a choice is stored. A game nobody has chosen for follows detection, and
 * choosing the detected answer is stored like any other, so a later change in
 * what the game has does not flip a choice somebody made.
 *
 * The switch never touches a blueprint. Terrain steps stay in the library
 * entry, in a share and in an export whichever way it is set, which is what
 * makes turning it off and on again lossless.
 *
 * Blueprint editor, for the terrain tools of issue #4793: call
 * `useTerrainChanges(archive, units)` and show the tools when `showTools` is
 * true.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { equivalentsKey } from "./equivalentsStore";
import { terrainSupport } from "./units";

/** Where the choices are kept. */
const STORAGE_KEY = "coilbox.blueprint.terrain";

function load(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return new Map();
    return new Map(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return new Map();
  }
}

let choices = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(choices)),
    );
  } catch {
    // No storage. This session keeps the choice and the next one starts again
    // from detection.
  }
}

/** What this game was switched to, or undefined when nobody chose. */
export function terrainOverrideFor(key: string): boolean | undefined {
  return choices.get(key);
}

/** Switch a game on or off, or pass undefined to go back to detection. */
export function setTerrainOverride(key: string, on: boolean | undefined): void {
  if (key === "") return;
  if (on === undefined) {
    if (!choices.delete(key)) return;
  } else {
    if (choices.get(key) === on) return;
    choices.set(key, on);
  }
  persist();
  for (const listener of listeners) listener();
}

/** Forget every choice. For tests, which each want to start from nothing. */
export function resetTerrainOverrides(): void {
  choices = new Map();
}

/** Start from what storage holds now, after a test has stubbed it. */
export function loadTerrainOverrides(): void {
  choices = load();
}

/**
 * The switch's position: the choice if there is one, else the detected answer.
 * Undefined when neither is known, which is a game whose units have not been
 * read. That is not the same as off, and nothing should say a game cannot make
 * terrain changes on that.
 */
export function terrainEnabled(
  detected: boolean | undefined,
  override: boolean | undefined,
): boolean | undefined {
  return override ?? detected;
}

/**
 * A layout as it is shown and its buildings are stood on (issue #4814). With
 * the switch off it is a flat blueprint: its steps are left out. Only what is
 * shown changes. The saved layout keeps its steps, so turning the switch back
 * on brings them back with nothing lost. Unknown is not off, so a game whose
 * units have not been read yet shows them.
 */
export function shownLayout<T extends { terrain?: readonly unknown[] }>(
  layout: T,
  enabled: boolean | undefined,
): T {
  if (enabled !== false || !layout.terrain) return layout;
  return { ...layout, terrain: undefined };
}

/**
 * Whether to say a layout's terrain changes are ones the game cannot make
 * (issue #4814). Only when the game cannot: a game the player switched off can
 * make them, and its blueprints are shown flat with nothing said.
 */
export function cannotMakeTerrain(
  detected: boolean | undefined,
  enabled: boolean | undefined,
): boolean {
  return detected === false && enabled === false;
}

export interface TerrainChanges {
  /** What the game's units say, or undefined until they have been read. */
  detected: boolean | undefined;
  /** The position of the switch, or undefined when it is not known yet. */
  enabled: boolean | undefined;
  /** Whether the editor offers terrain tools: only when known to be on. */
  showTools: boolean;
  /** Whether the switch was moved away from what detection says. */
  overridden: boolean;
  /** Set the switch. Passing the detected answer is still a choice. */
  setEnabled: (on: boolean) => void;
}

/**
 * The Terrain changes switch for one game, kept in step with the same switch
 * anywhere else in the app.
 *
 * Takes the archive name and units every caller already resolved through
 * `useGameUnits`, so no surface has to know how the choice is keyed.
 */
export function useTerrainChanges(
  gameArchive: string | undefined,
  units: { name: string }[],
): TerrainChanges {
  const key = equivalentsKey(gameArchive);
  const [override, setOverride] = useState(() => terrainOverrideFor(key));

  useEffect(() => {
    const listener = () => setOverride(terrainOverrideFor(key));
    listener();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);

  const detected = useMemo(
    () => (units.length > 0 ? terrainSupport(units) : undefined),
    [units],
  );
  const enabled = terrainEnabled(detected, override);
  const setEnabled = useCallback(
    (on: boolean) => setTerrainOverride(key, on),
    [key],
  );

  return {
    detected,
    enabled,
    showTools: enabled === true,
    overridden: override !== undefined && override !== detected,
    setEnabled,
  };
}
