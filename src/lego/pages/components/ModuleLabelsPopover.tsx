/**
 * Edit a module's category and tags from its cell (issue #3298).
 *
 * A popover with a tag button of its own, or, given `children` and `open`, one
 * hung off whatever the caller draws, such as a tile's actions menu (#4536).
 * The name is renamed in place, as before, so the popover leaves it alone.
 */

import { Button } from "@picoframe/frame";
import { Tag } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { LegoProject } from "../../model";
import {
  canonicalCategory,
  categorySuggestions,
  parseTags,
} from "../../moduleFilter";
import {
  type ModuleLabelsDraft,
  ModuleLabelsFields,
} from "./ModuleLabelsFields";

interface Props {
  compound: LegoProject;
  /** Every module, for the categories in use. */
  known: LegoProject[];
  className?: string;
  onSave: (
    compound: LegoProject,
    labels: { category: string | undefined; tags: string[] },
  ) => void;
  /** Opened by the caller rather than by a tag button, with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** What the popover hangs from when the caller opens it. */
  children?: ReactNode;
}

export function ModuleLabelsPopover({
  compound,
  known,
  className,
  onSave,
  open: openProp,
  onOpenChange,
  children,
}: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {children !== undefined ? (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={className}
            aria-label={`Category and tags of the ${compound.name} module`}
          >
            <Tag size={14} />
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent side="top" align="start" className="w-64 space-y-3">
        <LabelsForm
          compound={compound}
          known={known}
          onSave={(labels) => {
            onSave(compound, labels);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The fields and their Save button. Mounted afresh each time the popover
 * opens, so it starts from the module as it is now and an edit made elsewhere
 * is not overwritten.
 */
function LabelsForm({
  compound,
  known,
  onSave,
}: {
  compound: LegoProject;
  known: LegoProject[];
  onSave: (labels: { category: string | undefined; tags: string[] }) => void;
}) {
  const [draft, setDraft] = useState<ModuleLabelsDraft>(() => ({
    category: compound.category ?? "",
    tags: (compound.tags ?? []).join(", "),
  }));
  return (
    <>
      <ModuleLabelsFields
        draft={draft}
        onChange={setDraft}
        suggestions={categorySuggestions(known)}
      />
      <Button
        size="sm"
        onClick={() =>
          onSave({
            category: canonicalCategory(draft.category, known),
            tags: parseTags(draft.tags),
          })
        }
      >
        Save
      </Button>
    </>
  );
}
