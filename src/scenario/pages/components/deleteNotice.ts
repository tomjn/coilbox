/**
 * The undo affordance a panel delete leaves behind (issue #2280).
 *
 * The map toolbar carries the editor's undo and redo buttons, by design,
 * because the map is where the time goes. A trigger, objective or variable
 * deleted from a panel below it vanishes off screen from those buttons, with
 * nothing on screen to say Cmd+Z is the way back. This toast is that: it names
 * what went and repeats the same undo inline, next to where the delete
 * happened.
 *
 * It is a convenience, not a second undo path. `undo` passed in is the same
 * function Cmd+Z and the map toolbar call, so this toast disappearing changes
 * nothing about whether the delete can still be undone.
 *
 * One fixed id, so deleting several things in a row replaces the notice rather
 * than piling one on top of the last. Undo only ever steps back one edit at a
 * time regardless of how many notices are on screen, so showing more than the
 * latest would promise a choice the button cannot give.
 *
 * sonner's default toast lifetime (4s) is tuned for a message with nothing to
 * act on. This one is, for a keyboard or screen reader user without the
 * shortcut memorised, the only way to reach undo without a trip back up to the
 * map, so it stays up longer. sonner already pauses that clock for as long as
 * the toast is hovered or focused, which covers a keyboard user tabbing to the
 * action button before it would otherwise close.
 */

import { toast } from "sonner";

const DELETE_NOTICE_ID = "scenario-panel-delete";
const DELETE_NOTICE_DURATION_MS = 8_000;

export function notifyDeleted(message: string, undo: () => void): void {
  toast(message, {
    id: DELETE_NOTICE_ID,
    duration: DELETE_NOTICE_DURATION_MS,
    action: {
      label: "Undo",
      onClick: undo,
    },
  });
}
