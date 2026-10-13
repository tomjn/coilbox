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

let tracks: Tracks = new Map();
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Read the tracks on disk again. */
export async function refreshStoredTracks(): Promise<void> {
  try {
    const { tracks: list } = await contentReplayTracks(undefined);
    tracks = new Map(list.map((t) => [t.gameId, t]));
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

/**
 * Every track on disk by game id, kept current. Join it to replays by
 * `gameId`, leaving out replays with `remixed` set: a remix carries its
 * original's id and has no track of its own.
 */
export function useStoredTracks(): Tracks {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, readTracks, readTracks);
}

/** For tests: forget everything. */
export function resetReplayTracksForTests(): void {
  tracks = new Map();
  started = false;
  emit();
}

/** For tests: put tracks in place without a backend. */
export function seedReplayTracksForTests(seed: StoredReplayTrack[]): void {
  started = true;
  tracks = new Map(seed.map((t) => [t.gameId, t]));
  emit();
}
