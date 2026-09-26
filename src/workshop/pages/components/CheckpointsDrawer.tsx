/**
 * A project's checkpoints (issue #2657): named, described snapshots of its
 * edits, restorable in one action.
 *
 * A drawer rather than a section of the project (issue #3111), opened from
 * the header beside undo and redo because, like them, it applies to whichever
 * section is open. Saving a new one comes first, then the list, newest first, mixing whatever autosave
 * has taken with whatever the person has named themselves.
 *
 * Restoring and deleting are the only actions here. Nothing renames an
 * autosave into looking hand made: only a manual checkpoint's name and
 * description can be edited, the same distinction `Checkpoint.kind` draws.
 */
import { Button, Drawer, Input } from "@picoframe/frame";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Textarea } from "@/components/ui/textarea";
import type { Checkpoint } from "../../checkpoints";
import { describeEdits } from "../../project";

export function CheckpointsDrawer({
  open,
  onOpenChange,
  checkpoints,
  onSave,
  onRestore,
  onRename,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkpoints: Checkpoint[];
  onSave: (name: string, description: string | undefined) => void;
  onRestore: (checkpoint: Checkpoint) => void;
  onRename: (id: string, name: string, description: string | undefined) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const save = () => {
    onSave(name, description || undefined);
    setName("");
    setDescription("");
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Checkpoints"
      description="Named states of the whole project, to go back to in one action. Autosaved on a timer too, so a crash costs minutes rather than a session."
      width="28rem"
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">New checkpoint</h3>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Before the health rebalance"
                className="h-8"
              />
            </Field>
            <Field label="Description (optional)">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </Field>
            <Button type="submit" size="sm" disabled={!name.trim()}>
              <History className="size-3.5" />
              Save checkpoint
            </Button>
          </form>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">
            Saved{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {checkpoints.length}
            </span>
          </h3>
          {checkpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. Save one above, or wait for the next autosave.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {checkpoints.map((checkpoint) => (
                <CheckpointRow
                  key={checkpoint.id}
                  checkpoint={checkpoint}
                  onRestore={() => onRestore(checkpoint)}
                  onRename={(next, nextDescription) =>
                    onRename(checkpoint.id, next, nextDescription)
                  }
                  onDelete={() => onDelete(checkpoint.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

/** One checkpoint: its name (editable in place for a manual one), when it was
 *  taken, and what it holds, described the same way a project card describes
 *  the project itself. */
function CheckpointRow({
  checkpoint,
  onRestore,
  onRename,
  onDelete,
}: {
  checkpoint: Checkpoint;
  onRestore: () => void;
  onRename: (name: string, description: string | undefined) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(checkpoint.name);
  const [draftDescription, setDraftDescription] = useState(
    checkpoint.description ?? "",
  );

  const submit = () => {
    onRename(draft, draftDescription || undefined);
    setEditing(false);
  };

  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2">
      {editing ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            className="h-7"
          />
          <Textarea
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            onBlur={submit}
            rows={2}
            className="text-xs"
          />
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              if (checkpoint.kind !== "manual") return;
              setDraft(checkpoint.name);
              setDraftDescription(checkpoint.description ?? "");
              setEditing(true);
            }}
            title={
              checkpoint.kind === "manual"
                ? "Click to rename or describe this checkpoint"
                : undefined
            }
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <span className="truncate">{checkpoint.name}</span>
              {checkpoint.kind === "autosave" && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  Auto
                </span>
              )}
            </span>
            {checkpoint.description && (
              <p className="text-xs text-muted-foreground">
                {checkpoint.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {new Date(checkpoint.createdAt).toLocaleString()} ·{" "}
              {describeEdits(checkpoint.edits)}
            </p>
          </button>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onRestore}
              aria-label={`Restore ${checkpoint.name}`}
              title="Put the project back to how it was at this checkpoint, as one undo step"
            >
              <RotateCcw className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onDelete}
              aria-label={`Delete ${checkpoint.name}`}
              title="Delete this checkpoint"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
