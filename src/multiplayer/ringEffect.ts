import { announce, flashTaskbar } from "@/sound/context";
import type { EventId } from "@/sound/events";
import { playEvent } from "@/sound/play";

/**
 * Reaction to an autohost `!ring` (a `Delta::Ring` from the lobby). Autohosts ring
 * a battle room to poke AFK players, so the point is to grab attention even when the
 * player has wandered off: the whole app "reverberates" (a slight vibration + a touch
 * of blur that decays like a struck object settling), a sound plays, and
 * the OS taskbar/dock flashes so a player behind other windows still notices.
 *
 * All three affordances are best-effort and independent - a failure in one (blocked
 * audio, missing window permission) must never break the others or throw into the
 * event loop that calls this. Muting the sound in Sound settings leaves the reverb
 * and the flash alone, which is the point of them.
 */

const REVERB_CLASS = "ring-reverb";

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
 * Fire every ring affordance, saying which event it is for and what to announce.
 * Anything that has to reach a player who may have wandered off uses this: an
 * autohost ring, and a matchmaking match found, which runs on a countdown nobody
 * can afford to miss. They are separate events so a player can silence one
 * without the other.
 */
export function triggerAttention(event: EventId, announcement: string) {
  playEvent(event);
  playReverb();
  flashTaskbar("ring", true);
  announce(announcement, true);
}

/**
 * Fire every ring affordance. Called from the lobby event handler on a `Delta::Ring`.
 * `from` is the ringing user (usually the autohost).
 */
export function triggerRing(from?: string) {
  triggerAttention("ring", from ? `Rung by ${from}` : "Rung by the host");
}

// Dev-only hook so the effect can be exercised from devtools / tauri-mcp `execute_js`
// (`window.__coilboxRing("TestBot")`) without a live autohost.
if (import.meta.env.DEV) {
  (window as unknown as { __coilboxRing?: typeof triggerRing }).__coilboxRing =
    triggerRing;
}
