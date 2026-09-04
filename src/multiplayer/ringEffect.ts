import { announce, flashTaskbar, getAudioContext } from "./soundCue";

/**
 * Reaction to an autohost `!ring` (a `Delta::Ring` from the lobby). Autohosts ring
 * a battle room to poke AFK players, so the point is to grab attention even when the
 * player has wandered off: the whole app "reverberates" (a slight vibration + a touch
 * of blur that decays like a struck object settling), a synthesized gong plays, and
 * the OS taskbar/dock flashes so a player behind other windows still notices.
 *
 * All three affordances are best-effort and independent - a failure in one (blocked
 * audio, missing window permission) must never break the others or throw into the
 * event loop that calls this.
 */

const REVERB_CLASS = "ring-reverb";
const GONG_DURATION_S = 1.8;

/**
 * A gong is inharmonic: partials sit at non-integer ratios of the fundamental and each
 * decays exponentially, the higher ones faster, so the strike blooms bright then settles
 * into a low hum. We additively synthesize that with a handful of oscillators through a
 * gentle lowpass, matching the ~1.8s decay of the visual reverb so sound and motion settle
 * together.
 */
function playGong() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const base = 120; // Hz - a low, resonant strike rather than a shrill alarm
  // ratio, relative loudness, relative decay time (higher partials fade sooner)
  const partials: Array<[number, number, number]> = [
    [1.0, 1.0, 1.0],
    [1.52, 0.6, 0.85],
    [2.0, 0.5, 0.7],
    [2.67, 0.35, 0.55],
    [3.86, 0.22, 0.4],
    [5.1, 0.14, 0.3],
  ];

  const master = ctx.createGain();
  master.gain.value = 1.4; // driven hard so the ring carries across a room
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(4200, now);
  lowpass.frequency.exponentialRampToValueAtTime(700, now + GONG_DURATION_S);
  // Limiter: the six partials sum near full scale on the strike, so pushing the master
  // for loudness would hard-clip. A compressor tames that transient while letting the
  // sustained body get genuinely louder without harsh distortion.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  lowpass.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  for (const [ratio, level, decayScale] of partials) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = base * ratio;

    const g = ctx.createGain();
    const peak = level;
    const decay = GONG_DURATION_S * decayScale;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.008); // fast strike attack
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    osc.connect(g);
    g.connect(lowpass);
    osc.start(now);
    osc.stop(now + decay + 0.05);
  }
}

// Restart-safe reverb: dropping and re-adding the class (with a forced reflow between)
// replays the animation when rings land back to back. The class is removed on
// animationend so it never lingers.
function playReverb() {
  const root = document.getElementById("root");
  if (!root) return;
  root.classList.remove(REVERB_CLASS);
  void root.offsetWidth; // force reflow so the re-add restarts the animation
  root.classList.add(REVERB_CLASS);
  const clear = () => root.classList.remove(REVERB_CLASS);
  root.addEventListener("animationend", clear, { once: true });
  // Fallback: under prefers-reduced-motion the animation is `none`, so `animationend`
  // never fires - drop the class on a timer so it can't linger.
  window.setTimeout(clear, 2000);
}

/**
 * Fire every ring affordance, saying what for. Anything that has to reach a
 * player who may have wandered off uses this: an autohost ring, and a
 * matchmaking match found, which runs on a countdown nobody can afford to miss.
 */
export function triggerAttention(announcement: string) {
  playGong();
  playReverb();
  flashTaskbar("ring", true);
  announce(announcement, true);
}

/**
 * Fire every ring affordance. Called from the lobby event handler on a `Delta::Ring`.
 * `from` is the ringing user (usually the autohost).
 */
export function triggerRing(from?: string) {
  triggerAttention(from ? `Rung by ${from}` : "Rung by the host");
}

// Dev-only hook so the effect can be exercised from devtools / tauri-mcp `execute_js`
// (`window.__coilboxRing("TestBot")`) without a live autohost.
if (import.meta.env.DEV) {
  (window as unknown as { __coilboxRing?: typeof triggerRing }).__coilboxRing =
    triggerRing;
}
