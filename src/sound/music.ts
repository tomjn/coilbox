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

let element: HTMLAudioElement | null = null;
let queue: string[] = [];
let index = 0;
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
function buildQueue(tracks: string[], shuffle: boolean): string[] {
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

async function playCurrent(): Promise<void> {
  const el = ensureElement();
  const track = queue[index];
  if (!el || !track) return;
  el.src = assetUrl(track);
  el.volume = level;
  try {
    await el.play();
  } catch {
    // Autoplay can be refused before the player has interacted with the window.
    // The next call after a click succeeds, so there is nothing to recover here.
  }
}

/** Load the profile's tracks. Safe to call when it ships none. */
export function initMusic(): void {
  const config = getProfileSound();
  if (!config?.tracks?.length) return;
  queue = buildQueue(config.tracks, config.shuffle === true);
  index = 0;
  if (config.enabled) setMusicWanted(true);
}

/** Whether this build has any music at all, which is what shows the controls. */
export function hasMusic(): boolean {
  return getProfileSound() !== null;
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

function apply(): void {
  const shouldPlay =
    wanted && suspendedFor.size === 0 && level > 0 && queue.length > 0;
  const el = element;
  if (shouldPlay) {
    if (!el || el.paused) void playCurrent();
    return;
  }
  el?.pause();
}
