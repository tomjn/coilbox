import { Button, Input } from "@picoframe/frame";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * A day to filter by, as YYYY-MM-DD, or "" for no day. Webviews draw an empty
 * date input with today's date, which reads as a chosen day. So an empty
 * filter shows an "Any date" button instead, and the input only appears once
 * the reader asks to choose a day or already has one.
 */
export function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const labelId = useId();
  const buttonId = useId();
  const [choosing, setChoosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Which control takes focus once it mounts: set by a press on "Any date" or
  // on the clear button.
  const focusNext = useRef<"input" | "any" | null>(null);

  useEffect(() => {
    if (value) setChoosing(false);
  }, [value]);

  const showInput = value !== "" || choosing;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each swap between the two controls
  useEffect(() => {
    if (focusNext.current === "input")
      root.current?.querySelector("input")?.focus();
    if (focusNext.current === "any")
      root.current?.querySelector("button")?.focus();
    focusNext.current = null;
  }, [showInput]);

  return (
    <div
      ref={root}
      className="flex w-40 flex-col items-stretch gap-1.5 text-xs"
    >
      <span id={labelId} className="font-medium leading-none">
        {label}
      </span>
      {showInput ? (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            aria-labelledby={labelId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => {
              if (e.target.value === "") setChoosing(false);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Clear ${label.toLowerCase()}`}
            title="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              focusNext.current = "any";
              setChoosing(false);
              onChange("");
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          id={buttonId}
          type="button"
          size="sm"
          variant="outline"
          aria-labelledby={`${labelId} ${buttonId}`}
          onClick={() => {
            focusNext.current = "input";
            setChoosing(true);
          }}
        >
          Any date
        </Button>
      )}
    </div>
  );
}
