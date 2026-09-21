import { assetUrl } from "@/lib/assetUrl";
import { getProfileSound } from "@/profile/profile";

/**
 * Background music, played through an `HTMLAudioElement` rather than the Web
 * Audio graph the cues use. A track runs for minutes, so it streams from the
 * asset protocol and seeks, where a decoded buffer would sit in memory whole.
 *
 * That means the music group's volume cannot be a gain node either. The element
 * has a volume of its own, which is set from the same numbers.
 *
 * Nothing here plays unless a distribution ships tracks. Coilbox bundles no
 * audio at all.
 */

/**
 * A track either lives beside the app, where the asset protocol can stream it,
 * or inside a game archive, where only unitsync can reach it and hands it back
 * whole. The second kind becomes a blob URL, which seeks like a file and can be
 * released when the next track starts.
 */
export type Track =
  | { kind: "portable"; path: string }
  | { kind: "archive"; path: string; label: string };

let element: HTMLAudioElement | null = null;
let queue: Track[] = [];
let index = 0;
/** Resolves an archive track to a playable URL. Set by whoever owns unitsync. */
let archiveResolver: ((path: string) => Promise<string | null>) | null = null;
/** The blob URL currently playing, released when it is replaced. */
let blobUrl: string | null = null;
let level = 1;
/** What the player asked for, as opposed to whether it is sounding right now. */
let wanted = false;
/**
 * Everything currently holding the music quiet. A set rather than a flag
 * because the reasons are independent: a game ending while you are tabbed away
 * must not start the music up in a window you cannot see.
 */
const suspendedFor = new Set<SuspendReason>();

/** Why the music is paused despite the player wanting it. */
export type SuspendReason = "game" | "unfocused";

/** The track list, shuffled if the profile asked for that. */
function buildQueue(tracks: Track[], shuffle: boolean): Track[] {
  const list = [...tracks];
  if (!shuffle) return list;
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function ensureElement(): HTMLAudioElement | null {
  if (element) return element;
  if (typeof Audio === "undefined") return null;
  element = new Audio();
  element.preload = "none";
  // One track at a time, advancing on its own. `loop` would pin the first track
  // forever when a profile ships several.
  element.addEventListener("ended", () => {
    index = (index + 1) % Math.max(1, queue.length);
    void playCurrent();
  });
  // A track that will not load should not take the rest of the list with it.
  element.addEventListener("error", () => {
    if (queue.length < 2) return;
    index = (index + 1) % queue.length;
    void playCurrent();
  });
  return element;
}

/** Free the blob the last archive track was playing from. */
function releaseBlob(): void {
  if (!blobUrl) return;
  URL.revokeObjectURL(blobUrl);
  blobUrl = null;
}

async function urlFor(track: Track): Promise<string | null> {
  if (track.kind === "portable") return assetUrl(track.path);
  if (!archiveResolver) return null;
  const url = await archiveResolver(track.path);
  if (!url) return null;
  // Only after the new one exists, so a failed load leaves the old track
  // playable rather than killing the music outright.
  releaseBlob();
  blobUrl = url;
  return url;
}

async function playCurrent(): Promise<void> {
  const el = ensureElement();
  const track = queue[index];
  if (!el || !track) return;
  const url = await urlFor(track);
  // Fetching an archive track takes long enough for the player to have changed
  // their mind, or to have launched a game. Without this re-check, a pause that
  // lands mid-fetch is undone the moment the bytes arrive, and the music starts
  // playing with the button saying it is stopped.
  if (!url || !shouldPlay()) return;
  el.src = url;
  el.volume = level;
  try {
    await el.play();
  } catch {
    // Autoplay can be refused before the player has interacted with the window.
    // The next call after a click succeeds, so there is nothing to recover here.
  }
  if (!shouldPlay()) el.pause();
}

/** Load the profile's tracks. Safe to call when it ships none. */
export function initMusic(): void {
  const config = getProfileSound();
  if (!config?.tracks?.length) return;
  setTracks(
    config.tracks.map((path) => ({ kind: "portable", path }) as const),
    config.shuffle === true,
  );
  if (config.enabled) setMusicWanted(true);
}

/**
 * Replace the track list. Used by the profile at startup and by the game music
 * source when the player picks a different game.
 */
export function setTracks(tracks: Track[], shuffle = false): void {
  queue = buildQueue(tracks, shuffle);
  index = 0;
  releaseBlob();
  element?.pause();
  apply();
}

/**
 * How an archive track's bytes are fetched. Null puts archive music out of
 * reach.
 *
 * Re-applies afterwards, because a track list can arrive before the resolver
 * does. Without this, that ordering leaves the music wanted, unsuspended, and
 * silent, with nothing scheduled to try again.
 */
export function setArchiveResolver(
  resolver: ((path: string) => Promise<string | null>) | null,
): void {
  archiveResolver = resolver;
  if (resolver) apply();
}

/** The tracks currently queued, for a settings screen to list. */
export function getTracks(): Track[] {
  return queue;
}

/** Whether there is anything to play, which is what shows the music controls. */
export function hasMusic(): boolean {
  return getProfileSound() !== null || queue.length > 0;
}

/**
 * Set the music group's level. `volume` is 0..1, and muting stops the element
 * rather than playing it silently, so a muted track is not decoded for nothing.
 */
export function setMusicLevel(volume: number, muted: boolean): void {
  level = muted ? 0 : Math.min(1, Math.max(0, volume));
  if (element) element.volume = level;
  apply();
}

/** Start or stop the music, as the player asked. */
export function setMusicWanted(value: boolean): void {
  wanted = value;
  apply();
}

/**
 * Pause while something else deserves the room. Coilbox sits behind the engine
 * for most of a session, and lobby music over a live battle is the obvious
 * annoyance. Music from a window you have tabbed away from is the other.
 *
 * Kept apart from {@link setMusicWanted} so resuming puts the player back where
 * they were rather than starting music they had turned off.
 */
export function setMusicSuspended(reason: SuspendReason, value: boolean): void {
  if (value) suspendedFor.add(reason);
  else suspendedFor.delete(reason);
  apply();
}

/** Whether the music should be sounding right now, on everything known. */
function shouldPlay(): boolean {
  return wanted && suspendedFor.size === 0 && level > 0 && queue.length > 0;
}

function apply(): void {
  const el = element;
  if (shouldPlay()) {
    if (!el || el.paused) void playCurrent();
    return;
  }
  el?.pause();
}

// Dev-only hook for reading the player's state from devtools / tauri-mcp
// `execute_js`. The audio element is never in the DOM, so there is otherwise
// nothing to inspect. Matches `__coilboxMasterLevel` and `__coilboxSoundGraph`.
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as { __coilboxMusic?: () => unknown }).__coilboxMusic =
    () => ({
      wanted,
      suspendedFor: [...suspendedFor],
      level,
      tracks: queue.length,
      index,
      playing: element ? !element.paused : false,
      src: element?.src ?? null,
      seconds: element?.currentTime ?? null,
    });
}
