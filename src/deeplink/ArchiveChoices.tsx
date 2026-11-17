import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { CheckField } from "@/components/Field";

/** What the player picked in the archive install prompt. */
export interface ArchiveChoice {
  move: boolean;
  noPrompt: boolean;
}

/**
 * The two checkboxes under the archive install prompt. The dialog's `run` is
 * built before anything is ticked, so each change is also handed to
 * `onChange` for it to read.
 */
export function ArchiveChoices({
  initial,
  onChange,
}: {
  initial: ArchiveChoice;
  onChange: (choice: ArchiveChoice) => void;
}) {
  const { t } = useLingui();
  const [choice, setChoice] = useState(initial);
  const update = (next: ArchiveChoice) => {
    setChoice(next);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2 pt-1">
      <CheckField
        label={t`Delete the original after installing`}
        checked={choice.move}
        onChange={(move) => update({ ...choice, move })}
      />
      <CheckField
        label={t`Do not ask again`}
        checked={choice.noPrompt}
        onChange={(noPrompt) => update({ ...choice, noPrompt })}
      />
    </div>
  );
}
