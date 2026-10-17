/**
 * The save step for a module: pick which of its connectors mounts it on a
 * unit (issue #3297).
 *
 * A popover beside the toolbar button. It opens on the connector the module
 * would default to, and saving with "No mount" stores none.
 */

import { Button } from "@picoframe/frame";
import { PackagePlus } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { TipButton } from "@/components/TipButton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LegoMount, LegoProject } from "../../model";
import {
  canonicalCategory,
  categorySuggestions,
  parseTags,
} from "../../moduleFilter";
import type { ModuleConnector } from "../../moduleMount";
import {
  type ModuleLabelsDraft,
  ModuleLabelsFields,
} from "./ModuleLabelsFields";

const NONE = "none";

/** What the popover offers for the current selection. */
export interface MountOptions {
  choices: ModuleConnector[];
  /** The connector it opens on, or null for no mount. */
  initial: LegoMount | null;
  /** The modules already saved, for the categories in use. */
  known?: LegoProject[];
}

/** What the save step stores on the module besides its mount. */
export interface ModuleLabels {
  category: string | undefined;
  tags: string[];
}

interface Props {
  disabled: boolean;
  /** Asked each time the popover opens, because the selection changes. */
  options: () => MountOptions | null;
  onSave: (mount: LegoMount | null, labels: ModuleLabels) => void;
}

function keyOf(mount: LegoMount | null): string {
  return mount ? `${mount.piece}/${mount.connector}` : NONE;
}

export function SaveCompoundPopover({ disabled, options, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [offered, setOffered] = useState<MountOptions | null>(null);
  const [picked, setPicked] = useState(NONE);
  const [labels, setLabels] = useState<ModuleLabelsDraft>({
    category: "",
    tags: "",
  });

  function onOpenChange(next: boolean) {
    if (next) {
      const fresh = options();
      setOffered(fresh);
      setPicked(keyOf(fresh?.initial ?? null));
      setLabels({ category: "", tags: "" });
    }
    setOpen(next);
  }

  function save() {
    const choice = offered?.choices.find(
      (c) => keyOf({ piece: c.piece, connector: c.connector }) === picked,
    );
    onSave(
      choice ? { piece: choice.piece, connector: choice.connector } : null,
      {
        category: canonicalCategory(labels.category, offered?.known ?? []),
        tags: parseTags(labels.tags),
      },
    );
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <TipButton
          size="icon"
          variant="outline"
          disabled={disabled}
          aria-label="Save the selection as a module"
          title="Save as a module"
        >
          <PackagePlus className="size-4" />
        </TipButton>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 space-y-3">
        <Field label="Mounts on the unit by">
          <OptionSelect
            ariaLabel="Mount connector"
            value={picked}
            onValueChange={setPicked}
            options={[
              { value: NONE, label: "No mount" },
              ...(offered?.choices ?? []).map((c) => ({
                value: keyOf({ piece: c.piece, connector: c.connector }),
                label: c.label,
              })),
            ]}
          />
        </Field>
        <ModuleLabelsFields
          draft={labels}
          onChange={setLabels}
          suggestions={categorySuggestions(offered?.known ?? [])}
        />
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </PopoverContent>
    </Popover>
  );
}
