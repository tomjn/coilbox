/**
 * Whether the edit-in-place route can write this copy, said while it is being
 * edited (issue #3035).
 *
 * Mirrors `InPlaceNote` in `UnitFieldRow.tsx`, at the level of the whole copy
 * rather than one field: a copy is written as a file or not at all, so there
 * is one offer to send it to the mutator route, not one per field. Each
 * unwritable change is still named, the way a field's own refusal is, so the
 * user can see what about the copy is the problem before pressing anything.
 */
import { Button } from "@picoframe/frame";
import { FileLock2 } from "lucide-react";
import type { CloneUnwritable } from "../../inPlace";

export function CloneInPlaceNotice({
  unitName,
  unwritable,
  checking,
  error,
  routed,
  onRoute,
}: {
  unitName: string;
  /** The copy's own unwritable changes, once the dry run has answered.
   *  `null` while it is still checking. */
  unwritable: CloneUnwritable[] | null;
  checking: boolean;
  error: string | null;
  /** Whether the user has sent this whole copy through the mutator route. */
  routed: boolean;
  onRoute: (on: boolean) => void;
}) {
  if (error) {
    return (
      <p className="text-xs text-destructive">
        Coilbox could not check whether {unitName} can be written into the
        game's own files: {error}
      </p>
    );
  }
  if (!routed && (checking || !unwritable || unwritable.length === 0))
    return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <FileLock2 className="size-3.5 shrink-0" />
        <span>
          {routed
            ? "Goes through the mutator route. Writing in place skips this whole copy."
            : `${unwritable?.length ?? 0} change${unwritable?.length === 1 ? "" : "s"} to ${unitName} cannot be written into a file.`}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => onRoute(!routed)}
          aria-label={
            routed
              ? `Stop sending ${unitName} through the mutator route`
              : `Send ${unitName} through the mutator route`
          }
        >
          {routed ? "Undo" : "Send this copy to the mutator"}
        </Button>
      </div>
      {!routed && unwritable && unwritable.length > 0 && (
        <ul className="flex list-disc flex-col gap-0.5 pl-5">
          {unwritable.map((u) => (
            <li key={u.field}>
              <span className="font-mono">{u.field}</span>: {u.message}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">
        A copy is written as a file or not at all, so this sends the whole copy
        through the mutator route rather than only the change above. The
        in-place write then skips it and lists it as still needing a mutator.
      </p>
    </div>
  );
}
