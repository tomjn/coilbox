/**
 * A cylinder's or a tube's numbers in the piece panel (#3327): the axis it runs
 * along, its radius, length, wall and sides. A number the shape cannot take is
 * refused with a line saying why, and the shape keeps what it had.
 */

import { Button, Input } from "@picoframe/frame";
import { useEffect, useId, useState } from "react";

import { ButtonGroup } from "@/components/ui/button-group";
import {
  type RoundNumbers,
  roundNumbers,
  withRoundNumber,
} from "../../roundShape";
import type { LegoShape } from "../../shapes";
import { AXES } from "./TransformFields";

interface Props {
  shape: LegoShape;
  onChange: (shape: LegoShape) => void;
}

export function ShapeFields({ shape, onChange }: Props) {
  const numbers = roundNumbers(shape);
  // About the number just typed. The panel is keyed by piece, so another
  // piece starts clear.
  const [problem, setProblem] = useState<string | null>(null);

  function set(name: keyof RoundNumbers, value: number) {
    const result = withRoundNumber(shape, name, value);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    onChange(result.shape);
  }

  const fields: { name: keyof RoundNumbers; label: string }[] = [
    { name: "radius", label: "Radius" },
    { name: "length", label: "Length" },
    ...(numbers.wall === undefined
      ? []
      : [{ name: "wall" as const, label: "Wall" }]),
    { name: "sides", label: "Sides" },
  ];

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div>
        <span className="text-xs text-muted-foreground">Axis</span>
        <ButtonGroup className="mt-1 flex w-full" aria-label="Axis">
          {AXES.map((axis, index) => (
            <Button
              key={axis.label}
              size="sm"
              variant={numbers.axis === index ? "default" : "outline"}
              className="flex-1"
              aria-pressed={numbers.axis === index}
              onClick={() => set("axis", index)}
            >
              {axis.label}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fields.map(({ name, label }) => (
          <ShapeNumber
            key={name}
            label={label}
            value={numbers[name] ?? 0}
            onCommit={(value) => set(name, value)}
          />
        ))}
      </div>
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled number that holds what is typed until the field is left. */
function ShapeNumber({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const id = useId();
  const shown = String(Number(value.toFixed(3)));
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  function commit() {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(shown);
      return;
    }
    if (parsed !== value) onCommit(parsed);
    else setDraft(shown);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(shown);
        }}
        inputMode="decimal"
        className="h-7 px-1 text-right text-xs"
      />
    </div>
  );
}
