import { Input } from "@picoframe/frame";
import { useId, useState } from "react";

import type { SkeletonTarget } from "../../model";

interface Props {
  /** The values to start from. Give the component a new `key` to start over. */
  initial: SkeletonTarget;
  /** The target typed, or null while a field is not a usable number. */
  onChange: (target: SkeletonTarget | null) => void;
}

/** A whole number of steps of 1 or more, or null. */
function steps(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : null;
}

/** A height above zero, or null. */
function height(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The footprint in steps and the height in elmos a skeleton is sized to. Used
 * where a unit is started and in the skeleton panel.
 */
export function SkeletonTargetFields({ initial, onChange }: Props) {
  const id = useId();
  const [text, setText] = useState({
    x: String(initial.footprint.x),
    z: String(initial.footprint.z),
    height: String(initial.height),
  });

  function set(field: keyof typeof text, value: string) {
    const next = { ...text, [field]: value };
    setText(next);
    const x = steps(next.x);
    const z = steps(next.z);
    const h = height(next.height);
    onChange(
      x !== null && z !== null && h !== null
        ? { footprint: { x, z }, height: h }
        : null,
    );
  }

  const invalid = {
    x: steps(text.x) === null,
    z: steps(text.z) === null,
    height: height(text.height) === null,
  };

  const field = (
    name: keyof typeof text,
    label: string,
    unit: string,
    inputMode: "numeric" | "decimal",
  ) => (
    <div className="flex items-center justify-between gap-2">
      <label
        className="text-xs text-muted-foreground"
        htmlFor={`${id}-${name}`}
      >
        {label}
      </label>
      <span className="flex items-center gap-1">
        <Input
          id={`${id}-${name}`}
          value={text[name]}
          onChange={(event) => set(name, event.target.value)}
          inputMode={inputMode}
          aria-invalid={invalid[name]}
          className="h-7 w-16 px-1 text-right text-xs"
        />
        <span className="w-8 text-xs text-muted-foreground">{unit}</span>
      </span>
    </div>
  );

  return (
    <div className="space-y-1.5">
      {field("x", "Footprint across", "steps", "numeric")}
      {field("z", "Footprint deep", "steps", "numeric")}
      {field("height", "Height", "elmos", "decimal")}
    </div>
  );
}
