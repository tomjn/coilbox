import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

/**
 * Reaction to an incoming chat / private message that mentions one of your
 * highlight words or your own username (issue #193). A short, distinct two-note
 * "ping" plus the OS taskbar/dock flash so a mention still lands when you've tabbed
 * away. Deliberately lighter than the ring gong and different from the "host is
 * launching" chime so the three cues are tellable apart, and asset-free
 * (synthesized) to match their no-bundled-audio approach.
 *
 * Both affordances are best-effort and independent - a failure in one (blocked
 * audio, missing window permission) must never break the other or throw into the
 * event loop that calls this.
 */

// A single AudioContext is reused across cues, separate from the ring/ingame ones so
// the effects stay independent. WKWebView/WebView2 can hand it back "suspended" until
// a user gesture, so we resume on first interaction (below) and again before each cue.
let audioCtx: AudioContext | null = null;

type WebkitWindow = { webkitAudioContext?: typeof AudioContext };

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

// Unlock audio on the first user gesture so a later network-triggered cue can play
// without a gesture of its own (lobby users click/type long before any mention).
function unlockAudioOnce() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  window.removeEventListener("pointerdown", unlockAudioOnce);
  window.removeEventListener("keydown", unlockAudioOnce);
}
window.addEventListener("pointerdown", unlockAudioOnce, { once: true });
window.addEventListener("keydown", unlockAudioOnce, { once: true });

/**
 * A crisp two-note "ping" (a rising major third, A5 -> C#6), each a triangle wave
 * through a gentle lowpass with a quick attack and short decay at a modest gain.
 * Reads as a light "someone's talking to you" alert rather than an alarm.
 */
function playPing() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.28; // well below the ring gong's 1.4 - a nudge, not a klaxon
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 3200;
  lowpass.connect(master);
  master.connect(ctx.destination);

  // freq (Hz), start offset (s) - the second note lands as the first fades.
  const notes: Array<[number, number]> = [
    [880.0, 0.0], // A5
    [1108.73, 0.1], // C#6
  ];
  for (const [freq, at] of notes) {
    const start = now + at;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(1, start + 0.01); // quick soft attack
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
    osc.connect(g);
    g.connect(lowpass);
    osc.start(start);
    osc.stop(start + 0.28);
  }
}

// The ping is non-verbal, so announce the mention to assistive tech via a single
// reused visually-hidden live region.
let liveRegion: HTMLElement | null = null;
function announce(from: string) {
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.style.cssText =
      "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;";
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = `${from} mentioned you`;
}

function flashTaskbar() {
  // No focus check: the OS treats this as a no-op / auto-clears it when the window
  // is already focused, which is exactly the "you may have tabbed away" semantics we
  // want. Informational (not Critical) since a mention is a softer cue than a ring.
  getCurrentWindow()
    .requestUserAttention(UserAttentionType.Informational)
    .catch((e) => console.warn("mentionCue: requestUserAttention failed", e));
}

/**
 * Fire the mention cue. Called from the lobby event handler when an incoming
 * message matches the highlight predicate. `from` names the sender (for a11y).
 */
export function triggerMentionCue(from: string) {
  playPing();
  flashTaskbar();
  announce(from);
}

// Dev-only hook so the cue can be exercised from devtools / tauri-mcp `execute_js`
// (`window.__coilboxMentionCue("Someone")`) without a live mention.
if (import.meta.env.DEV) {
  (
    window as unknown as { __coilboxMentionCue?: typeof triggerMentionCue }
  ).__coilboxMentionCue = triggerMentionCue;
}
