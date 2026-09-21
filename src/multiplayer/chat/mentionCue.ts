import { announce, flashTaskbar } from "@/sound/context";
import { playEvent } from "@/sound/play";

/**
 * Reaction to an incoming chat / private message that mentions one of your
 * highlight words or your own username (issue #193). A sound plus the OS
 * taskbar/dock flash, so a mention still lands when you've tabbed away.
 *
 * Which sound, and how loud, is the player's to choose in Sound settings - this
 * only says that a mention happened. The flash and the screen reader
 * announcement are not sound and are not affected by muting the event.
 */

/**
 * Fire the mention cue. Called from the lobby event handler when an incoming
 * message matches the highlight predicate. `from` names the sender (for a11y).
 */
export function triggerMentionCue(from: string) {
  playEvent("mention");
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
