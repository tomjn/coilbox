import { type SoundName as CuelumeName, sounds as cuelumeNames } from "cuelume";
import { getAudioContext } from "./context";

/**
 * The sounds coilbox can play, and nothing about when to play them. An event
 * picks a sound from here by id (see events.ts), so the same ping can serve a
 * mention today and something else tomorrow without either knowing about the
 * other.
 *
 * Each is synthesized rather than loaded from a file, so the app bundles no
 * audio at all.
 *
 * The base levels below were tuned against each other, not picked
 * independently: the gong is driven hard because a ring has to carry across a
 * room, and the chime and ping sit far below it because they are nudges. Those
 * relative levels are the point, so they stay hardcoded here. Everything a
 * player controls is applied by the gain node each `play` is handed.
 */

const GONG_DURATION_S = 1.8;

/**
 * A gong is inharmonic: partials sit at non-integer ratios of the fundamental and each
 * decays exponentially, the higher ones faster, so the strike blooms bright then settles
 * into a low hum. We additively synthesize that with a handful of oscillators through a
 * gentle lowpass, matching the ~1.8s decay of the ring's visual reverb so sound and motion
 * settle together.
 */
function playGong(out: AudioNode) {
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
function playChime(out: AudioNode) {
  const ctx = getAudioContext();
  if (!ctx) return;
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
function playPing(out: AudioNode) {
  const ctx = getAudioContext();
  if (!ctx) return;
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

/**
 * A sound is either one coilbox synthesizes into a node we hand it, or one of
 * cuelume's, which owns its own AudioContext and can only be given a number.
 * The two are kept apart here rather than papered over, because only the first
 * kind can be turned down while it is already playing.
 */
type SoundDef =
  | {
      label: string;
      group: string;
      kind: "synth";
      /** How long it sounds for. Only the preview button's icon reads this. */
      seconds: number;
      play: (out: AudioNode) => void;
    }
  | {
      label: string;
      group: string;
      kind: "cuelume";
      seconds: number;
      name: CuelumeName;
    };

/**
 * How long each of cuelume's sounds lasts, in seconds.
 *
 * Measured from its recipes: the longest layer's offset plus attack plus decay,
 * plus a shimmer tail where there is one. cuelume publishes the names but not
 * the recipes, so these are read off rather than derived, and the fallback is
 * today's longest. Nothing but the preview icon depends on them, so drift shows
 * up as an icon that reverts slightly early or late.
 */
const CUELUME_SECONDS: Record<string, number> = {
  arrival: 1.055,
  bloom: 0.85,
  chime: 0.716,
  ready: 0.654,
  success: 0.604,
  loading: 0.535,
  droplet: 0.474,
  sparkle: 0.468,
  scan: 0.357,
  error: 0.244,
  whisper: 0.162,
  page: 0.122,
  pulse: 0.087,
  release: 0.057,
  toggle: 0.045,
  press: 0.021,
  tick: 0.019,
};

/** The bands the sound picker splits its list into. */
const COILBOX = "Coilbox";
const INTERFACE = "Interface";

/**
 * Cuelume's catalogue, offered for any event. Ids carry a `cue-` prefix because
 * cuelume ships a `chime` of its own and ours came first, and because a stored
 * id should say where the sound comes from.
 */
const CUELUME_SOUNDS = Object.fromEntries(
  cuelumeNames.map((name) => [
    `cue-${name}`,
    {
      label: `${name[0].toUpperCase()}${name.slice(1)}`,
      group: INTERFACE,
      kind: "cuelume",
      seconds: CUELUME_SECONDS[name] ?? 1.055,
      name,
    },
  ]),
) as {
  [K in CuelumeName as `cue-${K}`]: {
    label: string;
    group: string;
    kind: "cuelume";
    seconds: number;
    name: K;
  };
};

/** Every sound in the library, by id. Persisted in settings, so ids are stable. */
export const SOUNDS = {
  // Each `seconds` is the last moment an oscillator is still running in the
  // routine beside it, so the three stay together when one is retuned.
  gong: {
    label: "Gong",
    group: COILBOX,
    kind: "synth",
    seconds: GONG_DURATION_S + 0.05,
    play: playGong,
  },
  chime: {
    label: "Chime",
    group: COILBOX,
    kind: "synth",
    seconds: 0.13 + 0.36,
    play: playChime,
  },
  ping: {
    label: "Ping",
    group: COILBOX,
    kind: "synth",
    seconds: 0.1 + 0.28,
    play: playPing,
  },
  ...CUELUME_SOUNDS,
} as const satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];

/** Whether a stored sound choice still names a sound we have. */
export function isSoundId(v: unknown): v is SoundId {
  return typeof v === "string" && v in SOUNDS;
}
