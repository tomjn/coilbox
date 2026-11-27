import { useSetting } from "@picoframe/frame";
import {
  readStoredSettingIfInstalled,
  writeStoredSetting,
} from "@/lib/storedSetting";

/**
 * Replays this machine has seen on the hub, by game id (issue #5493). The hub
 * has no route that says whether it holds a match without sending one, so this
 * is what the replay browser marks and what the replay page links from before
 * anything is sent. It is written when a send ends with the hub holding the
 * match, whether this send uploaded it or the hub had it already.
 */
export const REPLAYS_ON_HUB_KEY = "hub.replaysOnHub";

export interface ReplayOnHub {
  /** The hub that holds it, as the hub address setting had it. */
  hubUrl: string;
  /** The replay's page on that hub. */
  url: string | null;
}

export type ReplaysOnHub = Record<string, ReplayOnHub>;

const NONE: ReplaysOnHub = {};

const base = (url: string) => url.replace(/\/+$/, "");

/** Note that this hub lists the replay with this game id. */
export function rememberReplayOnHub(gameId: string, record: ReplayOnHub) {
  const held = readStoredSettingIfInstalled<ReplaysOnHub>(
    REPLAYS_ON_HUB_KEY,
    NONE,
  );
  writeStoredSetting(REPLAYS_ON_HUB_KEY, { ...held, [gameId]: record });
}

/** Every replay this machine has seen on a hub, outside React. */
export function readReplaysOnHub(): ReplaysOnHub {
  return readStoredSettingIfInstalled<ReplaysOnHub>(REPLAYS_ON_HUB_KEY, NONE);
}

/** Every replay this machine has seen on a hub. */
export function useReplaysOnHub(): ReplaysOnHub {
  const [held] = useSetting<ReplaysOnHub>(REPLAYS_ON_HUB_KEY, NONE);
  return held;
}

/** The record for one replay on this hub, or undefined when none is known. */
export function replayOnHub(
  held: ReplaysOnHub,
  hubUrl: string,
  gameId: string | undefined,
): ReplayOnHub | undefined {
  if (!gameId) return undefined;
  const record = held[gameId];
  return record && base(record.hubUrl) === base(hubUrl) ? record : undefined;
}

/**
 * Replays a moderator took down from the hub, by game id. Coilbox does not send
 * one of these again.
 */
export const REPLAYS_REMOVED_KEY = "hub.replaysRemoved";

export type ReplaysRemoved = Record<string, { hubUrl: string }>;

const NONE_REMOVED: ReplaysRemoved = {};

/** Every replay this machine has heard was taken down, outside React. */
export function readReplaysRemoved(): ReplaysRemoved {
  return readStoredSettingIfInstalled<ReplaysRemoved>(
    REPLAYS_REMOVED_KEY,
    NONE_REMOVED,
  );
}

/** Note that this hub has taken this replay down. */
export function rememberReplayRemoved(gameId: string, hubUrl: string) {
  writeStoredSetting(REPLAYS_REMOVED_KEY, {
    ...readReplaysRemoved(),
    [gameId]: { hubUrl },
  });
  const held = readReplaysOnHub();
  if (replayOnHub(held, hubUrl, gameId)) {
    const { [gameId]: _, ...rest } = held;
    writeStoredSetting(REPLAYS_ON_HUB_KEY, rest);
  }
}

/** Every replay this machine has heard was taken down. */
export function useReplaysRemoved(): ReplaysRemoved {
  const [removed] = useSetting<ReplaysRemoved>(
    REPLAYS_REMOVED_KEY,
    NONE_REMOVED,
  );
  return removed;
}

/** Whether this hub has taken this replay down. */
export function replayRemoved(
  removed: ReplaysRemoved,
  hubUrl: string,
  gameId: string,
): boolean {
  const record = removed[gameId];
  return record !== undefined && base(record.hubUrl) === base(hubUrl);
}
