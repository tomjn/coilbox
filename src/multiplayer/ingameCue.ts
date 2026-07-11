import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

/**
 * Reaction to the host of the battle you're in launching the game (a
 * `Delta::PlayerWentIngame` whose name matches the battle founder). Unlike an
 * autohost `!ring` - a loud "get back here" gong - this is a gentle "it's
 * starting, get in" nudge: a soft two-note rising chime plus the OS taskbar/dock
 * flash so a player who has tabbed away still notices. Deliberately distinct from
 * (and quieter than) the ring gong so the two are tellable apart, and asset-free
 * (synthesized) to match the ring's no-bundled-audio approach.
 *
 * Both affordances are best-effort and independent - a failure in one (blocked
 * audio, missing window permission) must never break the other or throw into the
 * event loop that calls this.
 */

// A single AudioContext is reused across cues, separate from the ring's so the two
// effects stay independent. WKWebView/WebView2 can hand it back "suspended" until a
// user gesture, so we resume on first interaction (below) and again before each cue.
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
// without a gesture of its own (lobby users click/type long before any launch).
function unlockAudioOnce() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  window.removeEventListener("pointerdown", unlockAudioOnce);
  window.removeEventListener("keydown", unlockAudioOnce);
}
window.addEventListener("pointerdown", unlockAudioOnce, { once: true });
window.addEventListener("keydown", unlockAudioOnce, { once: true });

/**
 * A soft two-note rising chime (a perfect fourth, D5 -> G5), each a pure sine
 * through a gentle lowpass with a quick attack and short decay, played at a low
 * gain. Reads as an upbeat "ready" ping rather than an alarm.
 */
function playChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.3; // well below the ring gong's 1.4 - a nudge, not a klaxon
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 2600;
  lowpass.connect(master);
  master.connect(ctx.destination);

  // freq (Hz), start offset (s) - the second note lands as the first fades.
  const notes: Array<[number, number]> = [
    [587.33, 0.0], // D5
    [783.99, 0.13], // G5
  ];
  for (const [freq, at] of notes) {
    const start = now + at;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(1, start + 0.01); // quick soft attack
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    osc.connect(g);
    g.connect(lowpass);
    osc.start(start);
    osc.stop(start + 0.36);
  }
}

// The chime is non-verbal, so announce the launch to assistive tech via a single
// reused visually-hidden live region.
let liveRegion: HTMLElement | null = null;
function announce(host: string) {
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.style.cssText =
      "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;";
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = `${host} launched the game`;
}

function flashTaskbar() {
  // No focus check: the OS treats this as a no-op / auto-clears it when the window
  // is already focused, which is exactly the "you may have tabbed away" semantics
  // we want. Informational (not Critical) since this is a softer cue than ring.
  getCurrentWindow()
    .requestUserAttention(UserAttentionType.Informational)
    .catch((e) => console.warn("ingameCue: requestUserAttention failed", e));
}

/**
 * Fire the "host is launching" cue. Called from the lobby event handler when the
 * founder of the battle you're in goes in-game. `host` names them (for a11y).
 */
export function triggerIngameCue(host: string) {
  playChime();
  flashTaskbar();
  announce(host);
}

// Dev-only hook so the cue can be exercised from devtools / tauri-mcp `execute_js`
// (`window.__coilboxIngameCue("Host")`) without a live battle.
if (import.meta.env.DEV) {
  (
    window as unknown as { __coilboxIngameCue?: typeof triggerIngameCue }
  ).__coilboxIngameCue = triggerIngameCue;
}
