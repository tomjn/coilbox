import { useSyncExternalStore } from "react";
import {
  readStoredSettingIfInstalled,
  writeStoredSetting,
} from "@/lib/storedSetting";
import { isHubAssetUploadOffered } from "@/profile/profile";

/**
 * Finished matches waiting to be sent to the hub (issue #5494). Kept in the
 * settings, so a send that has to wait outlives a restart.
 */

/**
 * The switch, off until turned on. The same string as
 * `AUTO_REPLAY_SETTING_KEY` in the hub plugin's `consent.rs`, which reads it
 * off disk before it lets a replay go without a press of its send button.
 */
export const AUTO_SEND_REPLAYS_KEY = "hub.autoSendReplays";

export const REPLAY_SEND_QUEUE_KEY = "hub.replaySendQueue";

/** Matches whose analysis and track wait to be sent (issue #5495). */
export const REPLAY_EXTRAS_QUEUE_KEY = "hub.replayExtrasQueue";

export interface QueuedReplay {
  path: string;
  /** The content root and engine the match ran on, which it is read with. */
  dataDir: string;
  enginePath: string;
  queuedAt: number;
  /** Sends that ended with something worth another try. */
  attempts: number;
  /** When it may next be tried. */
  notBefore: number;
}

/**
 * A match whose analysis run has just finished, or whose track has just been
 * recorded, waiting for its analysis and then its track to be sent. Each send
 * waits for the hub to list the replay.
 */
export interface QueuedExtras {
  gameId: string;
  /** The map, for the messages. */
  mapName: string;
  queuedAt: number;
  attempts: number;
  notBefore: number;
}

const listeners = new Set<() => void>();
let revision = 0;

export function autoSendReplaysAllowed(): boolean {
  return (
    readStoredSettingIfInstalled<boolean>(AUTO_SEND_REPLAYS_KEY, false) &&
    isHubAssetUploadOffered()
  );
}

export function readReplaySendQueue(): QueuedReplay[] {
  return readStoredSettingIfInstalled<QueuedReplay[]>(
    REPLAY_SEND_QUEUE_KEY,
    [],
  );
}

function changed(): void {
  revision++;
  for (const listener of listeners) listener();
}

function write(queue: QueuedReplay[]): void {
  writeStoredSetting(REPLAY_SEND_QUEUE_KEY, queue);
  changed();
}

export function readReplayExtrasQueue(): QueuedExtras[] {
  return readStoredSettingIfInstalled<QueuedExtras[]>(
    REPLAY_EXTRAS_QUEUE_KEY,
    [],
  );
}

function writeExtras(queue: QueuedExtras[]): void {
  writeStoredSetting(REPLAY_EXTRAS_QUEUE_KEY, queue);
  changed();
}

/** Queue a match's analysis and track, when the setting is on and it is not
 *  queued already. */
export function queueReplayExtras(
  match: { gameId: string; mapName: string },
  now = Date.now(),
): void {
  if (!autoSendReplaysAllowed()) return;
  const queue = readReplayExtrasQueue();
  if (queue.some((item) => item.gameId === match.gameId)) return;
  writeExtras([
    ...queue,
    { ...match, queuedAt: now, attempts: 0, notBefore: now },
  ]);
}

/** Change a queued match. A no-op for one that has left the queue. */
export function updateQueuedExtras(
  gameId: string,
  patch: Partial<QueuedExtras>,
): void {
  const queue = readReplayExtrasQueue();
  if (!queue.some((item) => item.gameId === gameId)) return;
  writeExtras(
    queue.map((item) =>
      item.gameId === gameId ? { ...item, ...patch } : item,
    ),
  );
}

export function dropQueuedExtras(gameId: string): void {
  const queue = readReplayExtrasQueue();
  const kept = queue.filter((item) => item.gameId !== gameId);
  if (kept.length !== queue.length) writeExtras(kept);
}

/**
 * Queue the replay of a match that has just ended, when the setting is on.
 * Whether it is one the hub should get is decided when it is read, in
 * `runner.ts`.
 */
export function queueFinishedReplay(
  target: { dataDir: string; enginePath: string },
  replay: { path: string },
  now = Date.now(),
): void {
  if (!autoSendReplaysAllowed()) return;
  const queue = readReplaySendQueue();
  if (queue.some((item) => item.path === replay.path)) return;
  write([
    ...queue,
    {
      path: replay.path,
      dataDir: target.dataDir,
      enginePath: target.enginePath,
      queuedAt: now,
      attempts: 0,
      notBefore: now,
    },
  ]);
}

/** Change a queued replay. A no-op for one that has left the queue. */
export function updateQueuedReplay(
  path: string,
  patch: Partial<QueuedReplay>,
): void {
  const queue = readReplaySendQueue();
  if (!queue.some((item) => item.path === path)) return;
  write(
    queue.map((item) => (item.path === path ? { ...item, ...patch } : item)),
  );
}

export function dropQueuedReplay(path: string): void {
  const queue = readReplaySendQueue();
  const kept = queue.filter((item) => item.path !== path);
  if (kept.length !== queue.length) write(kept);
}

export function clearReplaySendQueue(): void {
  if (readReplaySendQueue().length > 0) write([]);
  if (readReplayExtrasQueue().length > 0) writeExtras([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Both queues, and a number that changes whenever either does. */
export function useReplaySendQueue(): {
  queue: QueuedReplay[];
  extras: QueuedExtras[];
  revision: number;
} {
  const seen = useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );
  return {
    queue: readReplaySendQueue(),
    extras: readReplayExtrasQueue(),
    revision: seen,
  };
}
