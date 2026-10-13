import { useSetting } from "@picoframe/frame";
import { useEffect, useSyncExternalStore } from "react";
import { contentReplayTracks, type StoredReplayTrack } from "./bindings";

/**
 * Recorded tracks on the frontend (#3786): the tracks on disk by game id, to
 * join to replays.
 *
 * Whether a replay has a track is read from the files each time and never kept
 * with the replay, so a track deleted outside the app does not leave a flag
 * behind. Anything that stores or removes a track calls {@link
 * refreshStoredTracks}.
 */

type Tracks = ReadonlyMap<string, StoredReplayTrack>;

/** What the tracks on disk take, for the storage settings (#3787). */
export interface TrackUsage {
  totalBytes: number;
  /** The disk budget used until the user sets one. Null until first read. */
  defaultBudgetBytes: number | null;
}

/**
 * The settings key for the disk budget, in bytes. Mirrored in `SETTING_KEY` in
 * `crates/tauri-plugin-coilbox-content/src/demo/track_budget.rs`, which reads
 * the settings file when a recording is stored.
 */
export const TRACK_BUDGET_SETTING = "content.replayTrackBudgetBytes";

const noUsage: TrackUsage = { totalBytes: 0, defaultBudgetBytes: null };

let tracks: Tracks = new Map();
let usage: TrackUsage = noUsage;
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Read the tracks on disk again. */
export async function refreshStoredTracks(): Promise<void> {
  try {
    const {
      tracks: list,
      totalBytes,
      defaultBudgetBytes,
    } = await contentReplayTracks(undefined);
    tracks = new Map(list.map((t) => [t.gameId, t]));
    usage = { totalBytes, defaultBudgetBytes };
    emit();
  } catch {
    // No bridge, or the folder could not be read. What is on screen stays.
  }
}

function start(): void {
  if (started) return;
  started = true;
  void refreshStoredTracks();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const readTracks = () => tracks;
const readUsage = () => usage;

/**
 * Every track on disk by game id, kept current. Join it to replays by
 * `gameId`, leaving out replays with `remixed` set: a remix carries its
 * original's id and has no track of its own.
 */
export function useStoredTracks(): Tracks {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, readTracks, readTracks);
}

/** What the tracks take on disk, kept current alongside {@link useStoredTracks}. */
export function useTrackUsage(): TrackUsage {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, readUsage, readUsage);
}

/**
 * The disk budget for tracks in bytes: the user's setting, or the default
 * until they set one. Null until the default has been read. Saving a budget
 * takes effect when the next recording is stored.
 */
export function useTrackBudget(): {
  budgetBytes: number | null;
  setBudgetBytes: (bytes: number) => void;
} {
  const [stored, setStored] = useSetting<number | null>(
    TRACK_BUDGET_SETTING,
    null,
  );
  const { defaultBudgetBytes } = useTrackUsage();
  return {
    budgetBytes: stored ?? defaultBudgetBytes,
    setBudgetBytes: setStored,
  };
}

/** For tests: forget everything. */
export function resetReplayTracksForTests(): void {
  tracks = new Map();
  usage = noUsage;
  started = false;
  emit();
}

/** For tests: put tracks in place without a backend. */
export function seedReplayTracksForTests(
  seed: StoredReplayTrack[],
  defaultBudgetBytes: number | null = null,
): void {
  started = true;
  tracks = new Map(seed.map((t) => [t.gameId, t]));
  usage = {
    totalBytes: seed.reduce((sum, t) => sum + t.sizeBytes, 0),
    defaultBudgetBytes,
  };
  emit();
}
