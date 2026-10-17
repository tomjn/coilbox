/**
 * Edit a module's category and tags from its cell (issue #3298).
 *
 * A popover beside the pencil. The name is renamed in place, as before, so the
 * popover leaves it alone.
 */

import { Button } from "@picoframe/frame";
import { Tag } from "lucide-react";
import { useState } from "react";

import {
  Popover,
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
}

export function ModuleLabelsPopover({
  compound,
  known,
  className,
  onSave,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ModuleLabelsDraft>({
    category: "",
    tags: "",
  });

  function onOpenChange(next: boolean) {
    // Read afresh each time, so an edit made elsewhere is not overwritten.
    if (next) {
      setDraft({
        category: compound.category ?? "",
        tags: (compound.tags ?? []).join(", "),
      });
    }
    setOpen(next);
  }

  function save() {
    onSave(compound, {
      category: canonicalCategory(draft.category, known),
      tags: parseTags(draft.tags),
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
      <PopoverContent side="top" align="start" className="w-64 space-y-3">
        <ModuleLabelsFields
          draft={draft}
          onChange={setDraft}
          suggestions={categorySuggestions(known)}
        />
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </PopoverContent>
    </Popover>
  );
}
