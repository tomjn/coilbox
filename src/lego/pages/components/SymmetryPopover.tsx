/**
 * The choices behind the symmetry button: a mirrored twin, or copies spaced
 * evenly round the vertical axis, and how many (issue #3317).
 *
 * A popover rather than a dialog, beside the button it belongs to. The count
 * applies to new rings, and to the ring around the selected piece if it is in
 * one.
 */

import { Input } from "@picoframe/frame";
import { Orbit } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { TipButton } from "@/components/TipButton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RING_MAX, RING_MIN, validRingCount } from "../../ringSet";
import type { SymmetryMode } from "../../useSymmetry";

interface Props {
  mode: SymmetryMode;
  onModeChange: (mode: SymmetryMode) => void;
  count: number;
  onCountChange: (count: number) => void;
}

export function SymmetryPopover({
  mode,
  onModeChange,
  count,
  onCountChange,
}: Props) {
  // What is typed, which is not a usable count until it parses. The field shows
  // this while it has focus and the real count otherwise.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <TipButton
          size="icon"
          variant="outline"
          aria-label="Symmetry options"
          title="Symmetry options"
        >
          <Orbit className="size-4" />
        </TipButton>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 space-y-3">
        <Field label="Copies">
          <OptionSelect
            ariaLabel="Symmetry mode"
            value={mode}
            onValueChange={(value) => onModeChange(value as SymmetryMode)}
            options={[
              { value: "mirror", label: "Mirrored twin" },
              { value: "ring", label: "Round the vertical axis" },
            ]}
          />
        </Field>
        {mode === "ring" ? (
          <Field label="Count">
            <Input
              type="number"
              min={RING_MIN}
              max={RING_MAX}
              step={1}
              aria-label="Copies round the axis"
              value={draft ?? String(count)}
              onChange={(event) => {
                setDraft(event.target.value);
                const next = event.target.valueAsNumber;
                if (validRingCount(next)) onCountChange(next);
              }}
              onBlur={() => setDraft(null)}
            />
          </Field>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
