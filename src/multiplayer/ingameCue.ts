import { announce, flashTaskbar } from "@/sound/context";
import { playEvent } from "@/sound/play";

/**
 * Reaction to the host of the battle you're in launching the game (a
 * `Delta::PlayerWentIngame` whose name matches the battle founder). Unlike an
 * autohost `!ring` - a loud "get back here" gong - this is a gentle "it's
 * starting, get in" nudge, plus the OS taskbar/dock flash so a player who has
 * tabbed away still notices.
 *
 * Which sound, and how loud, is the player's to choose in Sound settings. It
 * defaults to the chime, well below the ring gong, so the two stay tellable
 * apart.
 */

/**
 * Fire the "host is launching" cue. Called from the lobby event handler when the
 * founder of the battle you're in goes in-game. `host` names them (for a11y).
 */
export function triggerIngameCue(host: string) {
  playEvent("hostIngame");
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
