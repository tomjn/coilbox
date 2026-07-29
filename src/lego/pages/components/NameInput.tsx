/**
 * A field for a name that has to survive into a unit script.
 *
 * Normalising on every keystroke makes an underscore impossible to type: the
 * trailing one in "front_" is stripped before the next character arrives, so
 * the field reads "frontleg". The typed text is kept as it is and normalised
 * when the field is left, or on Enter.
 */

import { Input } from "@picoframe/frame";
import { useEffect, useState } from "react";

import { normalisePieceName } from "../../model";

interface Props {
  value: string;
  onCommit: (name: string) => void;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

export function NameInput({ value, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState(value);

  // Follow the document when it changes underneath, which is what selecting
  // another piece looks like from here.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const name = normalisePieceName(draft);
    setDraft(name);
    if (name !== value) onCommit(name);
  };

  return (
    <Input
      {...rest}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
