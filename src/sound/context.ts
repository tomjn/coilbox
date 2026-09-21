import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

/**
 * Shared plumbing behind every sound coilbox makes: the single AudioContext, the
 * master gain every cue is routed through, the unlock-on-first-gesture dance
 * WKWebView/WebView2 require, the taskbar/dock flash and the assistive-tech
 * announcement. Each cue still picks its own tone via its own oscillator routine
 * (see mentionCue.ts, ingameCue.ts and ringEffect.ts). This module owns the parts
 * that don't vary between them.
 *
 * Every affordance here is best-effort and independent - a failure in one
 * (blocked audio, missing window permission) must never break another or throw
 * into the event loop that calls it.
 */

// A single AudioContext is reused across every cue, so the unlock below only ever
// has to happen once. WKWebView/WebView2 can hand it back "suspended" until a user
// gesture, so we resume on first interaction (below) and again defensively before
// each cue plays.
let audioCtx: AudioContext | null = null;

type WebkitWindow = { webkitAudioContext?: typeof AudioContext };

export function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

/**
 * The player's master level, held here rather than read from the settings store,
 * because cues play from plain functions called out of the lobby event loop and
 * cannot reach React. SoundProvider pushes the current values in.
 *
 * Volume is 0..1 here, while the settings key and the slider are 0..100. The
 * default is full volume and unmuted, so a player who never opens Sound settings
 * hears exactly what they heard before this existed.
 */
let masterVolume = 1;
let masterMuted = false;
let masterGain: GainNode | null = null;

/**
 * The node every cue connects to instead of `ctx.destination`. One node for the
 * whole app, so the master volume and mute reach anything that makes a sound
 * without each cue having to consult a setting of its own.
 */
export function getMasterGain(): GainNode | null {
  if (masterGain) return masterGain;
  const ctx = getAudioContext();
  if (!ctx) return null;
  masterGain = ctx.createGain();
  masterGain.gain.value = masterMuted ? 0 : masterVolume;
  masterGain.connect(ctx.destination);
  return masterGain;
}

/**
 * The master level as a plain number, 0 when muted.
 *
 * For cuelume, which plays on its own AudioContext and so cannot be fed through
 * the master gain node. It takes a multiplier instead.
 */
export function getMasterLevel(): number {
  return masterMuted ? 0 : masterVolume;
}

/**
 * The master volume with its mute ignored, 0..1.
 *
 * Only the preview button wants this. Pressing play is an explicit ask to hear
 * a sound, so it has to be louder than a switch the player set days ago and
 * forgot, in a section further up the page.
 */
export function getMasterVolume(): number {
  return masterVolume;
}

/**
 * Point the master gain at a new level. Called by SoundProvider as the player
 * drags the slider, so it has to be safe to call before any cue has ever played.
 * The node does not exist yet in that case, and picks the level up when it is
 * created.
 *
 * `volume` is 0..1. A short ramp rather than a jumped value, so dragging the
 * slider while the ring gong is still decaying doesn't click.
 */
export function setMasterLevel(volume: number, muted: boolean): void {
  masterVolume = Math.min(1, Math.max(0, volume));
  masterMuted = muted;
  const target = masterMuted ? 0 : masterVolume;
  const ctx = audioCtx;
  if (!masterGain || !ctx) return;
  masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.015);
}

/**
 * Whether there is a browser to talk to. This module is reached from `notify()`,
 * which plenty of tests import in a plain node environment, and touching
 * `window` as the module loads would take all of them down.
 */
const hasWindow = typeof window !== "undefined";

// Dev-only hook so the master level can be read from devtools / tauri-mcp
// `execute_js` (`window.__coilboxMasterLevel()`), matching the `__coilboxRing`
// and `__coilboxMentionCue` hooks the cues expose. Reads the live gain node
// rather than the variables above, so it can catch the two drifting apart.
if (hasWindow && import.meta.env.DEV) {
  (
    window as unknown as { __coilboxMasterLevel?: () => unknown }
  ).__coilboxMasterLevel = () => ({
    volume: masterVolume,
    muted: masterMuted,
    gain: masterGain?.gain.value ?? null,
  });
}

// Unlock audio on the first user gesture so a later network-triggered cue can play
// without a gesture of its own (lobby users click/type long before any cue fires).
// Registered once for all cues, so whichever gesture comes first unlocks every cue
// rather than each one paying its own unlock independently.
function unlockAudioOnce() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  window.removeEventListener("pointerdown", unlockAudioOnce);
  window.removeEventListener("keydown", unlockAudioOnce);
}
if (hasWindow) {
  window.addEventListener("pointerdown", unlockAudioOnce, { once: true });
  window.addEventListener("keydown", unlockAudioOnce, { once: true });
}

// The cues are non-verbal, so each is also announced to assistive tech via a
// single reused visually-hidden live region shared by all of them.
let liveRegion: HTMLElement | null = null;
export function announce(text: string, assertive = false) {
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.style.cssText =
      "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;";
    document.body.appendChild(liveRegion);
  }
  liveRegion.setAttribute("aria-live", assertive ? "assertive" : "polite");
  if (assertive) {
    liveRegion.setAttribute("role", "alert");
  } else {
    liveRegion.removeAttribute("role");
  }
  liveRegion.textContent = text;
}

export function flashTaskbar(label: string, urgent = false) {
  // No focus check: the OS treats this as a no-op / auto-clears it when the window
  // is already focused, which is exactly the "you may have tabbed away" semantics
  // we want. Critical is reserved for the ring/matchmaking countdown, the other
  // cues are softer nudges and use Informational.
  getCurrentWindow()
    .requestUserAttention(
      urgent ? UserAttentionType.Critical : UserAttentionType.Informational,
    )
    .catch((e) => console.warn(`${label}: requestUserAttention failed`, e));
}
