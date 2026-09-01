import { Button } from "@picoframe/frame";
import { Check, Loader2, TriangleAlert } from "lucide-react";

/**
 * Where the campaign editor's last write got to (issue #2198).
 *
 * The editor has no save button. Typing in the title or description writes on
 * blur, and every other change writes as it is made, so an author had nothing
 * to look at and no way to tell a write that landed from one that never
 * happened.
 *
 * Which is why this reports the failure as loudly as the success. A tick that
 * can only ever say "Saved" teaches the author to trust it, and then says the
 * same thing on the day the disk is full. The failed state names what is at
 * risk, because the edit is still on screen and only the copy on disk is
 * behind, and offers the one action that can fix it.
 */
export type SaveState =
  /** Nothing written yet this session, so there is nothing to report. */
  | { kind: "idle" }
  /** Typed into, and no write asked for yet. The text boxes save on blur. */
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  /** The write was refused. The page's error banner carries the reason. */
  | { kind: "failed" };

/** The time of a save, in the reader's own locale. */
function savedTime(at: Date): string {
  return at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SaveStatus({
  state,
  onRetry,
}: {
  state: SaveState;
  /** Ask for the failed write again, with the document as it stands. */
  onRetry: () => void;
}) {
  if (state.kind === "idle") return null;

  if (state.kind === "failed") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 text-xs text-destructive"
      >
        <TriangleAlert className="size-3.5 shrink-0" />
        <span>Not saved. Leaving this page loses the change.</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {state.kind === "saving" && (
        <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" />
      )}
      {state.kind === "saved" && <Check className="size-3.5 shrink-0" />}
      <span>
        {state.kind === "unsaved" && "Unsaved changes"}
        {state.kind === "saving" && "Saving…"}
        {state.kind === "saved" && `Saved ${savedTime(state.at)}`}
      </span>
    </div>
  );
}
