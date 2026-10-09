import { assetUrl } from "@/lib/assetUrl";
import {
  readStoredSettingIfInstalled,
  settingsWritten,
  writeStoredSetting,
} from "@/lib/storedSetting";
import { getProfileSound } from "@/profile/profile";

/**
 * Background music, played through an `HTMLAudioElement` rather than the Web
 * Audio graph the cues use. A track runs for minutes, so it streams from the
 * asset protocol and seeks, where a decoded buffer would sit in memory whole.
 *
 * That means the music group's volume cannot be a gain node either. The element
 * has a volume of its own, which is set from the same numbers.
 *
 * Coilbox bundles one track of its own, and can otherwise play what a
 * distribution ships or what is inside a game's archive. None of it starts
 * until a player asks for it.
 */

/**
 * A track either lives beside the app, where the asset protocol can stream it,
 * or inside a game archive, where only unitsync can reach it and hands it back
 * whole. The second kind becomes a blob URL, which seeks like a file and can be
 * released when the next track starts.
 */
export type Track =
  | { kind: "portable"; path: string }
  | { kind: "archive"; path: string; label: string }
  // Bundled into the app by the build, so it already has a URL the element can
  // stream and needs neither the asset protocol nor unitsync.
  | { kind: "bundled"; url: string; label: string };

/**
 * True only while the first playback attempt of a session is in flight. On some
 * Linux systems the web process hangs inside the audio call and never comes back,
 * so the marker is what the next launch finds to learn the last attempt never
 * returned. It lives in settings because nothing else survives the hang.
 */
export const MUSIC_ATTEMPTING_KEY = "sound.music.attempting";

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
/** Whether a `play()` has resolved this session, after which the marker is not needed. */
let attemptProven = false;
/** How many attempts have set the marker and not yet ended. */
let attemptsMarked = 0;
/** Set when this launch found the marker left over from an attempt that hung. */
let turnedOffByHang = false;
const hangListeners = new Set<() => void>();

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

/**
 * Bumped by anything that makes an in-flight load irrelevant: a new track list,
 * or starting a different track. A load that finishes holding a stale number
 * throws its result away instead of stamping it over whatever is playing now.
 *
 * Reading a track out of a `.sdz` is slow enough for two loads to overlap
 * easily. Switching game twice in a few seconds is all it takes, and without
 * this the loser of the race revokes the winner's blob URL out from under the
 * element, which stops the music dead with no error anywhere.
 */
let loadToken = 0;

async function urlFor(track: Track, token: number): Promise<string | null> {
  if (track.kind === "bundled") return track.url;
  if (track.kind === "portable") return assetUrl(track.path);
  if (!archiveResolver) return null;
  const url = await archiveResolver(track.path);
  if (!url) return null;
  if (token !== loadToken) {
    // Someone else's track is playing now. This one was fetched for nothing,
    // so free it rather than leaking it.
    URL.revokeObjectURL(url);
    return null;
  }
  // Only after the new one exists, so a failed load leaves the old track
  // playable rather than killing the music outright.
  releaseBlob();
  blobUrl = url;
  return url;
}

/**
 * Record on disk that an attempt is starting, and wait until it is there. Called
 * before the first thing that can hang: creating the element, setting its `src`
 * and calling `play()`. Awaiting the flush is what orders the write ahead of the
 * risky call. Without it the write is only queued, and the hang could land first.
 */
async function markAttemptStarted(): Promise<boolean> {
  if (attemptProven) return false;
  attemptsMarked += 1;
  writeStoredSetting(MUSIC_ATTEMPTING_KEY, true);
  await settingsWritten();
  return true;
}

/**
 * Called when a marked attempt is over without a hang: `play()` came back, or
 * the attempt was dropped before it got that far. Only a `play()` that resolved
 * proves the audio path, because a refused one may never have reached it.
 *
 * The marker is cleared when the last marked attempt ends, not the first. Two
 * can overlap, and clearing on the first would leave the second unguarded.
 */
function markAttemptOver(proven: boolean): void {
  if (proven) attemptProven = true;
  attemptsMarked -= 1;
  if (attemptsMarked === 0) writeStoredSetting(MUSIC_ATTEMPTING_KEY, false);
}

/**
 * Run once at boot, before any music is started. A marker still set means the
 * previous attempt never returned, so music stays off for this launch and the
 * marker is cleared. Returns whether that happened, so the caller can turn the
 * stored play setting off as well.
 *
 * Closing the app normally in the instant `play()` is pending leaves the marker
 * set too. The next launch then turns music off once, which is accepted rather
 * than guarded against.
 */
export function recoverFromHungAttempt(): boolean {
  if (!readStoredSettingIfInstalled(MUSIC_ATTEMPTING_KEY, false)) return false;
  writeStoredSetting(MUSIC_ATTEMPTING_KEY, false);
  turnedOffByHang = true;
  wanted = false;
  notifyHang();
  return true;
}

/** Whether music was turned off this session because the last attempt hung. */
export function getTurnedOffByHang(): boolean {
  return turnedOffByHang;
}

export function subscribeTurnedOffByHang(listener: () => void): () => void {
  hangListeners.add(listener);
  return () => hangListeners.delete(listener);
}

/** The player pressed play again, which is a fresh attempt under the same guard. */
export function clearTurnedOffByHang(): void {
  if (!turnedOffByHang) return;
  turnedOffByHang = false;
  notifyHang();
}

function notifyHang(): void {
  for (const listener of hangListeners) listener();
}

async function playCurrent(): Promise<void> {
  const track = queue[index];
  if (!track || (!element && typeof Audio === "undefined")) return;
  loadToken += 1;
  const token = loadToken;
  const url = await urlFor(track, token);
  // Fetching an archive track takes long enough for the player to have changed
  // their mind, or to have launched a game. Without this re-check, a pause that
  // lands mid-fetch is undone the moment the bytes arrive, and the music starts
  // playing with the button saying it is stopped.
  if (!url || token !== loadToken || !shouldPlay()) return;
  const marked = await markAttemptStarted();
  // The marker write took a round trip to the backend, long enough for the
  // player to have paused or switched game again.
  const el = token === loadToken && shouldPlay() ? ensureElement() : null;
  if (!el) {
    if (marked) markAttemptOver(false);
    return;
  }
  el.src = url;
  el.volume = level;
  let played = false;
  try {
    await el.play();
    played = true;
  } catch {
    // Autoplay can be refused before the player has interacted with the window.
    // The next call after a click succeeds, so there is nothing to recover here.
  }
  if (marked) markAttemptOver(played);
  if (token !== loadToken || !shouldPlay()) el.pause();
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
  // Anything still loading belongs to the list being replaced. Retiring the
  // token here is what stops the previous game's track arriving late and
  // playing over the one the player just chose.
  loadToken += 1;
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
  // Held off after a hung attempt until the player presses play, whatever the
  // stored setting or the profile says.
  wanted = value && !turnedOffByHang;
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
