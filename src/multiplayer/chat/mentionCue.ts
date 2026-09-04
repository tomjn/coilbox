import { announce, flashTaskbar, getAudioContext } from "../soundCue";

/**
 * Reaction to an incoming chat / private message that mentions one of your
 * highlight words or your own username (issue #193). A short, distinct two-note
 * "ping" plus the OS taskbar/dock flash so a mention still lands when you've tabbed
 * away. Deliberately lighter than the ring gong and different from the "host is
 * launching" chime so the three cues are tellable apart, and asset-free
 * (synthesized) to match their no-bundled-audio approach.
 */

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

/**
 * Fire the mention cue. Called from the lobby event handler when an incoming
 * message matches the highlight predicate. `from` names the sender (for a11y).
 */
export function triggerMentionCue(from: string) {
  playPing();
  flashTaskbar("mentionCue");
  announce(`${from} mentioned you`);
}

// Dev-only hook so the cue can be exercised from devtools / tauri-mcp `execute_js`
// (`window.__coilboxMentionCue("Someone")`) without a live mention.
if (import.meta.env.DEV) {
  (
    window as unknown as { __coilboxMentionCue?: typeof triggerMentionCue }
  ).__coilboxMentionCue = triggerMentionCue;
}
