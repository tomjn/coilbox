import { Input } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import { tidyName } from "../../startNames";

/**
 * A start position's name, edited in place. Enter or leaving the box keeps
 * what was typed, Escape puts back what was there. The name is trimmed, and an
 * empty one means no name.
 */
export function PlaceNameInput({
  value,
  label,
  onCommit,
}: {
  /** The name now, or null for none. */
  value: string | null;
  /** What a screen reader calls the box. */
  label: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const cancelled = useRef(false);
  useEffect(() => setDraft(value ?? ""), [value]);

  const commit = () => {
    const next = tidyName(draft);
    if (next === (value ?? "")) setDraft(value ?? "");
    else onCommit(next);
  };

  return (
    <Input
      aria-label={label}
      placeholder="Name this place"
      className="h-7 min-w-28 text-xs"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        cancelled.current = false;
      }}
      onBlur={() => {
        if (cancelled.current) cancelled.current = false;
        else commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
    />
  );
}
