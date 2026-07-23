import { Button } from "@picoframe/frame";
import { StickyNote } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { NOTE_MAX_LENGTH } from "./notes";

/**
 * Add/edit/clear affordance for a private, client-side note about `name` (issue
 * #341). A filled icon plus non-native `title` tooltip surface an existing note
 * without relying on colour alone; the popover itself is the editor, matching
 * `MemberActionsMenu`'s inline-form-in-a-popover pattern rather than a modal.
 * Saving a blank (whitespace-only) note clears it — `onSave("")` is the delete
 * path, handled by the `notes.ts` store. When `statsSummary` is given (from the
 * local replay-stats database, #375) it's shown above the note field, e.g. "5
 * games with this player · 2W/1L as teammates".
 */
export function NoteButton({
  name,
  note,
  onSave,
  statsSummary,
}: {
  name: string;
  /** Current saved note text; "" means none. */
  note: string;
  onSave: (text: string) => void;
  /** "N games with this player…" summary from the local stats database, or
   * undefined when there's nothing to say (no shared replays, or unavailable). */
  statsSummary?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note);
  const hasNote = note.trim().length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setDraft(note);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            hasNote ? `Edit note for ${name}` : `Add note for ${name}`
          }
          title={
            hasNote ? note : (statsSummary ?? undefined) || "Add a private note"
          }
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
            hasNote && "text-amber-600 dark:text-amber-400",
          )}
        >
          <StickyNote
            className="size-4"
            fill={hasNote ? "currentColor" : "none"}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
            setOpen(false);
          }}
        >
          <p className="px-1 text-sm font-medium">Note: {name}</p>
          {statsSummary && (
            <p className="px-1 text-xs text-muted-foreground">{statsSummary}</p>
          )}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX_LENGTH))}
            maxLength={NOTE_MAX_LENGTH}
            placeholder="Private note, only visible to you…"
            aria-label={`Note for ${name}`}
            autoFocus
            className="min-h-20 text-sm"
          />
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-muted-foreground">
              {draft.length}/{NOTE_MAX_LENGTH}
            </span>
            <div className="flex gap-2">
              {hasNote && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    onSave("");
                    setOpen(false);
                  }}
                >
                  Clear
                </Button>
              )}
              <Button type="submit" size="sm" className="h-7">
                Save
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
