import { getAudioContext, getMasterGain } from "./context";

/**
 * The tones coilbox can play. Each is synthesized rather than loaded from a file,
 * so the app bundles no audio at all.
 *
 * Their gains were tuned against each other, not picked independently: the gong
 * is driven hard because a ring has to carry across a room, and the chime and
 * ping sit far below it because they are nudges. Those relative levels are the
 * point, so they stay hardcoded here and the player's master volume scales all of
 * them together through `getMasterGain()`.
 */

const GONG_DURATION_S = 1.8;

/**
 * A gong is inharmonic: partials sit at non-integer ratios of the fundamental and each
 * decays exponentially, the higher ones faster, so the strike blooms bright then settles
 * into a low hum. We additively synthesize that with a handful of oscillators through a
 * gentle lowpass, matching the ~1.8s decay of the ring's visual reverb so sound and motion
 * settle together.
 */
export function playGong() {
  const ctx = getAudioContext();
  const out = getMasterGain();
  if (!ctx || !out) return;
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

  const cueGain = ctx.createGain();
  cueGain.gain.value = 1.4; // driven hard so the ring carries across a room
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(4200, now);
  lowpass.frequency.exponentialRampToValueAtTime(700, now + GONG_DURATION_S);
  // Limiter: the six partials sum near full scale on the strike, so pushing the gain
  // for loudness would hard-clip. A compressor tames that transient while letting the
  // sustained body get genuinely louder without harsh distortion. It sits before the
  // master gain so turning the volume down scales an already-limited signal rather
  // than changing how hard the limiter works.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  lowpass.connect(cueGain);
  cueGain.connect(limiter);
  limiter.connect(out);

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

/**
 * A soft two-note rising chime (a perfect fourth, D5 -> G5), each a pure sine
 * through a gentle lowpass with a quick attack and short decay, played at a low
 * gain. Reads as an upbeat "ready" ping rather than an alarm.
 */
export function playChime() {
  const ctx = getAudioContext();
  const out = getMasterGain();
  if (!ctx || !out) return;
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const cueGain = ctx.createGain();
  cueGain.gain.value = 0.3; // well below the ring gong's 1.4 - a nudge, not a klaxon
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 2600;
  lowpass.connect(cueGain);
  cueGain.connect(out);

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

/**
 * A crisp two-note "ping" (a rising major third, A5 -> C#6), each a triangle wave
 * through a gentle lowpass with a quick attack and short decay at a modest gain.
 * Reads as a light "someone's talking to you" alert rather than an alarm.
 */
export function playPing() {
  const ctx = getAudioContext();
  const out = getMasterGain();
  if (!ctx || !out) return;
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const cueGain = ctx.createGain();
  cueGain.gain.value = 0.28; // well below the ring gong's 1.4 - a nudge, not a klaxon
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 3200;
  lowpass.connect(cueGain);
  cueGain.connect(out);

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
