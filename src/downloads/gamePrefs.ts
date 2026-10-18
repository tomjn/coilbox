import { useSyncExternalStore } from "react";
import {
  readStoredSettingIfInstalled,
  writeStoredSetting,
} from "../lib/storedSetting";
import type { SourceStep } from "./sourceWalk";

/**
 * What the player has chosen for one game on its page (issue #4580): a source
 * to try first, and whether its updates are shown.
 *
 * Stored under the game's download key (see `downloadKey`), the same key the
 * download history uses, so a download that only knows the game's name finds
 * the choice.
 */
export interface GamePrefs {
  /** Tried ahead of the default order. */
  pin?: SourceStep;
  /** False when the player has turned this game's updates off. */
  updates?: boolean;
}

export const GAME_PREFS_KEY = "library.gamePrefs";

export type GamePrefsStore = Record<string, GamePrefs>;

const EMPTY: GamePrefsStore = {};

/** The stored choices for every game. Answers empty with no storage installed. */
export function readGamePrefs(): GamePrefsStore {
  const value = readStoredSettingIfInstalled<GamePrefsStore>(
    GAME_PREFS_KEY,
    EMPTY,
  );
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : EMPTY;
}

/** The pinned source of the first key that has one. */
export function pinnedSource(
  store: GamePrefsStore,
  ...keys: string[]
): SourceStep | undefined {
  for (const k of keys) {
    const pin = store[k]?.pin;
    if (pin) return pin;
  }
  return undefined;
}

/** The keys whose game has its updates turned off. */
export function updatesOffKeys(store: GamePrefsStore): Set<string> {
  return new Set(
    Object.entries(store)
      .filter(([, p]) => p.updates === false)
      .map(([k]) => k),
  );
}

/** Whether two steps name the same source and mirror. */
export function sameStep(a: SourceStep | undefined, b: SourceStep): boolean {
  return !!a && a.source === b.source && (a.mirror ?? null) === b.mirror;
}

const listeners = new Set<() => void>();
let snapshot: GamePrefsStore | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): GamePrefsStore {
  snapshot ??= readGamePrefs();
  return snapshot;
}

/**
 * Change one game's choices. Read-modify-write against storage, so two changes
 * in one pass both land. A game left with no choice is dropped from the store.
 */
export function changeGamePrefs(
  key: string,
  patch: (p: GamePrefs) => GamePrefs,
): void {
  const { [key]: prev, ...rest } = readGamePrefs();
  const next = patch(prev ?? {});
  const kept = Object.values(next).some((v) => v !== undefined);
  writeStoredSetting<GamePrefsStore>(
    GAME_PREFS_KEY,
    kept ? { ...rest, [key]: next } : rest,
  );
  snapshot = null;
  for (const fn of listeners) fn();
}

/** Pin a source for a game, or clear the pin with null. */
export function setGamePin(key: string, pin: SourceStep | null): void {
  changeGamePrefs(key, (p) => ({ ...p, pin: pin ?? undefined }));
}

/** Turn a game's updates on or off. */
export function setGameUpdates(key: string, on: boolean): void {
  changeGamePrefs(key, (p) => ({ ...p, updates: on ? undefined : false }));
}

/** Every game's choices, re-read whenever one changes. */
export function useGamePrefs(): GamePrefsStore {
  return useSyncExternalStore(subscribe, getSnapshot);
}
