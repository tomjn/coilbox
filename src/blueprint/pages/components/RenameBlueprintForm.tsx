/**
 * Rename a layout from the library (issue #1476).
 *
 * A layout's only name field was the editor's, in the popover behind the
 * "N buildings" button, which is not a place anybody would look to rename
 * something. That field stays exactly where it is and stays the only way to
 * rename a layout that is open: a rename made while the editor is running has
 * to be a step in its history, or an undo of the drag before it takes the
 * rename with it (issue #1454).
 *
 * A layout on a card is not open. Nothing is holding a history of it, so the
 * library can write the new name straight out, the same way it writes a copy or
 * a delete. One name still, and one route to it per state the layout is in.
 */

import { Button, Input } from "@picoframe/frame";
import { useId, useState } from "react";

import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/content/pages/components/states";
import type { StoredBlueprint } from "../../library";
import { saveBlueprint } from "../../store";

/**
 * The record under a new name, or null when there is nothing to write.
 *
 * Nothing to write covers both a name that says nothing and the name it already
 * had, because neither is a rename and a layout with a blank name is a card
 * nobody can pick out of a grid.
 */
export function renamedRecord(
  record: StoredBlueprint,
  name: string,
): StoredBlueprint | null {
  const wanted = name.trim();
  if (!wanted || wanted === record.layout.name) return null;
  return { ...record, layout: { ...record.layout, name: wanted } };
}

export function RenameBlueprintForm({
  record,
  onDone,
}: {
  record: StoredBlueprint;
  /** Called once the new name is on disk, so the drawer can close itself. */
  onDone: (record: StoredBlueprint) => void;
}) {
  const id = useId();
  const [text, setText] = useState(record.layout.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = renamedRecord(record, text);

  async function rename() {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await saveBlueprint(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void rename();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} className="text-xs font-medium">
          Layout name
        </Label>
        <Input
          id={id}
          // The drawer opened for this one box, and reaching it by tab is a
          // step nobody asked for.
          autoFocus
          value={text}
          placeholder="What this layout is called"
          onChange={(e) => setText(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          What the library, the pickers and anybody you share it with call this
          layout. Two layouts can share a name, so this is yours to say.
        </p>
      </div>

      {error && <ErrorBanner message={`Not renamed: ${error}`} />}

      <Button type="submit" disabled={busy || !next}>
        {busy ? "Renaming…" : "Rename"}
      </Button>
    </form>
  );
}
