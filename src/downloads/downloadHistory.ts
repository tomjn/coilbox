import { useSyncExternalStore } from "react";
import { stripVersion } from "../career/games";
import {
  readStoredSettingIfInstalled,
  writeStoredSetting,
} from "../lib/storedSetting";

/**
 * Where each game and map came from, and what happened the last time coilbox
 * tried to fetch it (issue #4576).
 *
 * It lives in the frame's settings store under one key, so it is saved to the
 * settings file in the app data folder and is there again after a restart. That
 * needs no Rust command.
 *
 * One record is kept for each source and mirror an item has been fetched from,
 * and the latest result replaces the one before. That bounds the store by the
 * number of real sources rather than by how often a download is retried, and
 * answers what the game page asks: for this source, did it work, when, and if
 * not, why.
 */

export const DOWNLOAD_HISTORY_KEY = "downloads.history";

export type DownloadSourceKind =
  | "rapid"
  | "github"
  | "springfiles"
  | "hakora"
  | "evolutionrts"
  | "url"
  | "file";

/** What a downloader reports about one attempt on one source. */
export interface DownloadAttempt {
  source: DownloadSourceKind;
  outcome: "ok" | "failed";
  /** The rapid tag, the release tag or the address that was fetched. */
  reference: string | null;
  filename: string | null;
  /** The md5 the source gave, when it gave one. */
  md5: string | null;
  /** The host that served the file, for a source with several. */
  mirror: string | null;
  /** Why it failed. Null when it did not. #4577 writes the plain wording. */
  failure: string | null;
  durationMs: number;
}

/** A stored attempt: what happened and when. `at` is an ISO 8601 date. */
export interface DownloadRecord extends DownloadAttempt {
  at: string;
}

/** Item key, then source and mirror, to the latest record. */
export type DownloadHistory = Record<string, Record<string, DownloadRecord>>;

/**
 * The key an item is stored under. A game is its name without the version, lower
 * case, which is the library's id for a game the hub does not list. A map is its
 * spring name. A reader holding a hub shortname passes that to {@link recordsFor}
 * as well.
 */
export function downloadKey(kind: "game" | "map", name: string): string {
  return kind === "game"
    ? `game:${stripVersion(name).toLowerCase()}`
    : `map:${name.trim().toLowerCase()}`;
}

/** The host of an address, or null when it is not one. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

export function subscribeDownloadHistory(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Held between writes so React sees the same object until the next one. */
let snapshot: DownloadHistory | null = null;

export function readDownloadHistory(): DownloadHistory {
  const value = readStoredSettingIfInstalled<DownloadHistory>(
    DOWNLOAD_HISTORY_KEY,
    {},
  );
  // A value that is not a record would break every reader, so treat it as empty.
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

/**
 * Store one attempt for an item. Read-modify-write against storage, so two
 * attempts finishing in one pass both land. Does nothing with no storage
 * installed, which only a test can see.
 */
export function recordDownload(
  key: string,
  attempt: DownloadAttempt,
  now: Date = new Date(),
): void {
  const history = readDownloadHistory();
  const slot = `${attempt.source}|${attempt.mirror ?? ""}`;
  writeStoredSetting<DownloadHistory>(DOWNLOAD_HISTORY_KEY, {
    ...history,
    [key]: {
      ...history[key],
      [slot]: { ...attempt, at: now.toISOString() },
    },
  });
  snapshot = null;
  for (const fn of listeners) fn();
}

/** Every record under these keys, newest first. */
export function recordsFor(
  history: DownloadHistory,
  ...keys: string[]
): DownloadRecord[] {
  return keys
    .flatMap((k) => Object.values(history[k] ?? {}))
    .sort((a, b) => b.at.localeCompare(a.at));
}

function getSnapshot(): DownloadHistory {
  snapshot ??= readDownloadHistory();
  return snapshot;
}

/** The history, re-read whenever the queue records a download. */
export function useDownloadHistory(): DownloadHistory {
  return useSyncExternalStore(subscribeDownloadHistory, getSnapshot);
}
