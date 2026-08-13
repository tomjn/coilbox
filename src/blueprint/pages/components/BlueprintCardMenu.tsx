/**
 * What can be done to a layout without opening it (issues #1476 and #1477).
 *
 * Duplicate was on the detail page only and rename was in the editor's popover,
 * so a variant meant opening the layout, pressing it, and landing on the copy,
 * and a rename meant finding a field behind a button that counts buildings.
 * Both are things you decide about a layout you are looking at in a list of
 * them, which is here.
 *
 * A menu rather than more buttons on the card: the card is a link, and a button
 * inside a link is a link nobody can trust. The menu sits beside the link and
 * above it, so the card opens the layout everywhere except on the one control
 * that does something else.
 *
 * The copy stays in the library rather than opening. Pressing Duplicate on the
 * detail page is a step towards editing the copy, and pressing it here is a step
 * towards having one, so this lands the copy in the grid and leaves you in it.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { Copy, Loader2, MoreVertical, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { nextDrawerKey } from "@/general/drawerKey";
import { duplicatedBlueprint, type StoredBlueprint } from "../../library";
import { saveBlueprint } from "../../store";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BlueprintCardMenu({
  record,
  taken,
}: {
  record: StoredBlueprint;
  /** Every name in the library, so a copy of "Opening solars" is offered as
   *  "Opening solars 2" rather than as a twin. */
  taken: string[];
}) {
  const drawer = useDrawer();
  const [busy, setBusy] = useState(false);

  /** A drawer rather than a box in the menu, because a menu item that is a form
   *  is neither, and because this is how the rest of the library asks for
   *  something about one layout. */
  async function rename() {
    const { RenameBlueprintForm } = await import("./RenameBlueprintForm");
    drawer.open({
      title: `Rename ${record.layout.name}`,
      width: "24rem",
      content: (
        <RenameBlueprintForm
          key={nextDrawerKey()}
          record={record}
          onDone={(saved) => {
            drawer.close();
            toast.success(`That layout is now "${saved.layout.name}".`);
          }}
        />
      ),
    });
  }

  async function duplicate() {
    setBusy(true);
    try {
      const copy = duplicatedBlueprint(record, taken);
      await saveBlueprint(copy);
      toast.success(`"${copy.layout.name}" is yours to change.`);
    } catch (e) {
      toast.error(`That layout could not be copied: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground"
          aria-label={`Actions for ${record.layout.name}`}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreVertical className="size-4" aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => void rename()}>
          <Pencil className="size-4" aria-hidden="true" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => void duplicate()}>
          <Copy className="size-4" aria-hidden="true" /> Duplicate
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
