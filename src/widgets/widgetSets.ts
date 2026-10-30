/**
 * One set of widgets that are on for every game, and a game's own set in place
 * of it (issue #4844).
 *
 * Games know nothing of these sets. Each reads only its own config file, so
 * coilbox writes the set that applies to a game into that file before it
 * launches the game. A player can still switch widgets in the game, which saves
 * to the same file, so before each launch and whenever the widget page opens
 * coilbox reads the file back and takes any difference from what it last wrote
 * there as an edit to the set that applies.
 *
 * A set says on or off for each widget by the name its game saves it under. A
 * widget the set says nothing about is written as off.
 */

import { useSyncExternalStore } from "react";
import {
  readStoredSettingIfInstalled,
  writeStoredSetting,
} from "@/lib/storedSetting";
import type { GameHandler, WidgetRow } from "./widgetList";
import { savedUnder, type WidgetSwitch } from "./widgetNames";

/** On or off for each widget, by the name its state is saved under. */
export type WidgetStates = Readonly<Record<string, boolean>>;

export interface WidgetSets {
  /** The set for every game without one of its own. */
  global: WidgetStates;
  /** A game's own set, which replaces the global one, by {@link setKey}. */
  overrides: Readonly<Record<string, WidgetStates>>;
  /** What coilbox last wrote to each config file, by the file's full path. */
  written: Readonly<Record<string, WidgetStates>>;
}

export const EMPTY_SETS: WidgetSets = {
  global: {},
  overrides: {},
  written: {},
};

/** Which override a game uses. By short name, which is also what names most
 *  config files, so a new version of a game keeps its set. */
export function setKey(game: Pick<GameHandler, "game" | "shortName">): string {
  return game.shortName ?? game.game;
}

/** `record[key]`, not counting what every object inherits, so a widget or
 *  game named `constructor` reads as unset. */
export function entry<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The set a game uses: its own when it has one, otherwise the global one. */
export function appliedSet(sets: WidgetSets, key: string | null): WidgetStates {
  return (key !== null && entry(sets.overrides, key)) || sets.global;
}

/** A widget with a switch, which is one a set can say something about. */
export type SwitchableWidget = Extract<WidgetSwitch, { kind: "ready" }> & {
  /** Its `GetInfo().enabled`, which a handler goes by for a widget its file
   *  has no entry for. */
  enabled: boolean;
};

/** The widgets `game` loads whose saved name is certain (#1290). The rest
 *  cannot be written without guessing, so they are left alone. */
export function gameWidgets(
  rows: readonly WidgetRow[],
  game: string,
): SwitchableWidget[] {
  const found: SwitchableWidget[] = [];
  for (const row of rows) {
    if (row.switch.kind === "ready" && row.loadedBy.includes(game)) {
      found.push({ ...row.switch, enabled: row.info?.enabled === true });
    }
  }
  return found;
}

function withSet(
  sets: WidgetSets,
  key: string,
  change: (set: WidgetStates) => WidgetStates,
): WidgetSets {
  const own = entry(sets.overrides, key);
  if (own) {
    const next = change(own);
    return next === own
      ? sets
      : { ...sets, overrides: { ...sets.overrides, [key]: next } };
  }
  const next = change(sets.global);
  return next === sets.global ? sets : { ...sets, global: next };
}

/**
 * Take what the game's config file at `path` holds into the set the game uses.
 *
 * A widget whose entry differs from what coilbox last wrote there was switched
 * outside coilbox, so the set takes the file's answer. A widget coilbox has
 * never written there takes the file's answer only when the set has none, so
 * the first read of each game fills an empty set in rather than one game's
 * file overruling what another's already said. With no entry in the file
 * either, the set takes what the widget declares, which is what the game
 * would have done with it.
 */
export function absorbFile(
  sets: WidgetSets,
  key: string,
  path: string,
  order: ReadonlyMap<string, number>,
  widgets: readonly SwitchableWidget[],
): WidgetSets {
  const last = entry(sets.written, path) ?? {};
  const changes: Record<string, boolean> = {};
  const defaults: Record<string, boolean> = {};
  const set = appliedSet(sets, key);
  for (const w of widgets) {
    const saved = savedUnder(w, (n) => order.has(n));
    if (saved === null) {
      // No entry to compare with what was written, so only an unset widget
      // learns anything from it.
      if (entry(set, w.name) === undefined) defaults[w.name] = w.enabled;
      continue;
    }
    const inFile = (order.get(saved) ?? 0) > 0;
    const wrote = entry(last, w.name);
    if (
      wrote === undefined ? entry(set, w.name) === undefined : inFile !== wrote
    ) {
      changes[w.name] = inFile;
    }
  }
  if (Object.keys(changes).length === 0 && Object.keys(defaults).length === 0) {
    return sets;
  }
  const next = withSet(sets, key, (s) => ({ ...s, ...defaults, ...changes }));
  if (Object.keys(changes).length === 0) return next;
  return {
    ...next,
    written: { ...next.written, [path]: { ...last, ...changes } },
  };
}

/** Every widget the game loads, on or off as its set says. */
export function statesToWrite(
  sets: WidgetSets,
  key: string,
  widgets: readonly SwitchableWidget[],
): Map<string, boolean> {
  const set = appliedSet(sets, key);
  return new Map(widgets.map((w) => [w.name, set[w.name] === true]));
}

/** Remember what was written to `path`, so a later read can tell the game's
 *  edits from coilbox's own. */
export function recordWrite(
  sets: WidgetSets,
  path: string,
  states: ReadonlyMap<string, boolean>,
): WidgetSets {
  return {
    ...sets,
    written: {
      ...sets.written,
      [path]: { ...entry(sets.written, path), ...Object.fromEntries(states) },
    },
  };
}

/**
 * Switch a widget in the global set when `key` is null, or in that game's
 * own set otherwise. A game without a set of its own gets one, starting as a
 * copy of the global set.
 */
export function switchIn(
  sets: WidgetSets,
  key: string | null,
  name: string,
  on: boolean,
): WidgetSets {
  if (key === null) return { ...sets, global: { ...sets.global, [name]: on } };
  const own = entry(sets.overrides, key) ?? sets.global;
  return {
    ...sets,
    overrides: { ...sets.overrides, [key]: { ...own, [name]: on } },
  };
}

/**
 * Record newly added widgets: on in the set the player was looking at (the
 * global one when `key` is null, otherwise that game's own, made if it had
 * none), and off, said outright, in every other set. A set that says nothing
 * about a widget is written as off too, but a handler can switch on a widget
 * its file has no entry for, so the sets spell it out.
 */
export function addWidgets(
  sets: WidgetSets,
  key: string | null,
  names: readonly string[],
): WidgetSets {
  if (names.length === 0) return sets;
  const off = Object.fromEntries(names.map((n) => [n, false]));
  const on = Object.fromEntries(names.map((n) => [n, true]));
  const existing = Object.fromEntries(
    Object.entries(sets.overrides).map(([k, set]) => [
      k,
      { ...set, ...(k === key ? on : off) },
    ]),
  );
  // A computed key in a literal makes an own property even when it is
  // `__proto__`, which assigning to it would not.
  const overrides =
    key !== null && !entry(existing, key)
      ? { ...existing, [key]: { ...sets.global, ...on } }
      : existing;
  return {
    ...sets,
    global: { ...sets.global, ...(key === null ? on : off) },
    overrides,
  };
}

/** Send a game back to the global set. */
export function dropOverride(sets: WidgetSets, key: string): WidgetSets {
  if (!entry(sets.overrides, key)) return sets;
  const { [key]: _dropped, ...rest } = sets.overrides;
  return { ...sets, overrides: rest };
}

// ---------------------------------------------------------------------------
// The stored sets
// ---------------------------------------------------------------------------

export const WIDGET_SETS_KEY = "widgets.sets";

let current: WidgetSets | null = null;
const listeners = new Set<() => void>();

export function readSets(): WidgetSets {
  current ??= readStoredSettingIfInstalled(WIDGET_SETS_KEY, EMPTY_SETS);
  return current;
}

/** Fold `change` over the stored sets. Synchronous, so two changes in one
 *  pass both land. */
export function updateSets(change: (sets: WidgetSets) => WidgetSets) {
  const prev = readSets();
  const next = change(prev);
  if (next === prev) return;
  current = next;
  writeStoredSetting(WIDGET_SETS_KEY, next);
  for (const listener of listeners) listener();
}

/** Forget the sets read so far. For tests, which share this module. */
export function resetSets() {
  current = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWidgetSets(): WidgetSets {
  return useSyncExternalStore(subscribe, readSets);
}
