import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

/**
 * Shared plumbing behind coilbox's synthesized sound cues: a chat mention, the
 * host launching the game, and an autohost ring. Each cue picks its own tone via
 * its own oscillator routine (see mentionCue.ts, ingameCue.ts and ringEffect.ts).
 * This module owns the parts that don't vary between them - the single
 * AudioContext, the unlock-on-first-gesture dance WKWebView/WebView2 require, the
 * taskbar/dock flash and the assistive-tech announcement.
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
  const Ctor =
    window.AudioContext ??
    (window as unknown as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

// Unlock audio on the first user gesture so a later network-triggered cue can play
// without a gesture of its own (lobby users click/type long before any cue fires).
// Registered once for all three cues, so whichever gesture comes first unlocks
// every cue rather than each one paying its own unlock independently.
function unlockAudioOnce() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  window.removeEventListener("pointerdown", unlockAudioOnce);
  window.removeEventListener("keydown", unlockAudioOnce);
}
window.addEventListener("pointerdown", unlockAudioOnce, { once: true });
window.addEventListener("keydown", unlockAudioOnce, { once: true });

// The cues are non-verbal, so each is also announced to assistive tech via a
// single reused visually-hidden live region shared by all three.
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
