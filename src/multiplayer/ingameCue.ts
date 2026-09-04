import { announce, flashTaskbar, getAudioContext } from "./soundCue";

/**
 * Reaction to the host of the battle you're in launching the game (a
 * `Delta::PlayerWentIngame` whose name matches the battle founder). Unlike an
 * autohost `!ring` - a loud "get back here" gong - this is a gentle "it's
 * starting, get in" nudge: a soft two-note rising chime plus the OS taskbar/dock
 * flash so a player who has tabbed away still notices. Deliberately distinct from
 * (and quieter than) the ring gong so the two are tellable apart, and asset-free
 * (synthesized) to match the ring's no-bundled-audio approach.
 */

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

/**
 * Fire the "host is launching" cue. Called from the lobby event handler when the
 * founder of the battle you're in goes in-game. `host` names them (for a11y).
 */
export function triggerIngameCue(host: string) {
  playChime();
  flashTaskbar("ingameCue");
  announce(`${host} launched the game`);
}

// Dev-only hook so the cue can be exercised from devtools / tauri-mcp `execute_js`
// (`window.__coilboxIngameCue("Host")`) without a live battle.
if (import.meta.env.DEV) {
  (
    window as unknown as { __coilboxIngameCue?: typeof triggerIngameCue }
  ).__coilboxIngameCue = triggerIngameCue;
}
