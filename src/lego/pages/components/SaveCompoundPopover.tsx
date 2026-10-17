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
import type { LegoMount } from "../../model";
import type { ModuleConnector } from "../../moduleMount";

const NONE = "none";

/** What the popover offers for the current selection. */
export interface MountOptions {
  choices: ModuleConnector[];
  /** The connector it opens on, or null for no mount. */
  initial: LegoMount | null;
}

interface Props {
  disabled: boolean;
  /** Asked each time the popover opens, because the selection changes. */
  options: () => MountOptions | null;
  onSave: (mount: LegoMount | null) => void;
}

function keyOf(mount: LegoMount | null): string {
  return mount ? `${mount.piece}/${mount.connector}` : NONE;
}

export function SaveCompoundPopover({ disabled, options, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [offered, setOffered] = useState<MountOptions | null>(null);
  const [picked, setPicked] = useState(NONE);

  function onOpenChange(next: boolean) {
    if (next) {
      const fresh = options();
      setOffered(fresh);
      setPicked(keyOf(fresh?.initial ?? null));
    }
    setOpen(next);
  }

  function save() {
    const choice = offered?.choices.find(
      (c) => keyOf({ piece: c.piece, connector: c.connector }) === picked,
    );
    onSave(
      choice ? { piece: choice.piece, connector: choice.connector } : null,
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
          aria-label="Save the selection as a compound"
          title="Save as a compound"
        >
          <PackagePlus className="size-4" />
        </TipButton>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 space-y-3">
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
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </PopoverContent>
    </Popover>
  );
}
