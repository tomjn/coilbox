/**
 * How far the selected piece may turn, as two short fields for each axis it
 * can be limited on (issue #3353).
 *
 * Each field holds what you type until you leave it, as the transform fields
 * do. A range is stored once both ends are numbers with the first below the
 * second, and both blank clears it. Anything in between is kept in the field
 * and marked, and the document is left as it was.
 */

import { useLingui } from "@lingui/react/macro";
import { Input } from "@picoframe/frame";
import { useEffect, useState } from "react";

import { limitAxes } from "../../jointLimits";
import type { LegoAngleRange, LegoPiece, LegoPieceLimits } from "../../model";

interface Props {
  piece: LegoPiece;
  onChange: (limits: LegoPieceLimits | undefined) => void;
}

export function JointLimitFields({ piece, onChange }: Props) {
  const { t } = useLingui();
  const AXES = {
    yaw: {
      label: t`Turn range, ° right`,
      from: t`Turn from`,
      to: t`Turn to`,
    },
    pitch: {
      label: t`Lift range, ° up`,
      from: t`Lift from`,
      to: t`Lift to`,
    },
  } as const;
  const axes = limitAxes(piece.role);
  if (axes.length === 0) return null;

  function setRange(axis: "yaw" | "pitch", range: LegoAngleRange | undefined) {
    const { [axis]: _old, ...rest } = piece.limits ?? {};
    const next: LegoPieceLimits = range ? { ...rest, [axis]: range } : rest;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {axes.map((axis) => (
        <RangeRow
          key={`${piece.id}-${axis}`}
          label={AXES[axis].label}
          fromLabel={AXES[axis].from}
          toLabel={AXES[axis].to}
          range={piece.limits?.[axis]}
          onCommit={(range) => setRange(axis, range)}
        />
      ))}
    </div>
  );
}

function show(value: number | undefined): string {
  return value === undefined ? "" : String(Number(value.toFixed(3)));
}

function RangeRow({
  label,
  fromLabel,
  toLabel,
  range,
  onCommit,
}: {
  label: string;
  fromLabel: string;
  toLabel: string;
  range: LegoAngleRange | undefined;
  onCommit: (range: LegoAngleRange | undefined) => void;
}) {
  const { t } = useLingui();
  const [from, setFrom] = useState(show(range?.min));
  const [to, setTo] = useState(show(range?.max));

  // Follow the document when it changes underneath, such as an undo or a mirror
  // twin being edited.
  useEffect(() => {
    setFrom(show(range?.min));
    setTo(show(range?.max));
  }, [range?.min, range?.max]);

  const low = Number.parseFloat(from);
  const high = Number.parseFloat(to);
  const blank = from.trim() === "" && to.trim() === "";
  const valid = Number.isFinite(low) && Number.isFinite(high) && low < high;

  function commit() {
    if (blank) {
      if (range) onCommit(undefined);
      return;
    }
    if (!valid) return;
    if (range?.min !== low || range?.max !== high) {
      onCommit({ min: low, max: high });
    }
  }

  const field = (
    value: string,
    set: (text: string) => void,
    name: string,
    placeholder: string,
  ) => (
    <Input
      value={value}
      onChange={(event) => set(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      inputMode="decimal"
      aria-label={name}
      aria-invalid={!blank && !valid}
      placeholder={placeholder}
      className="h-7 px-1 text-right text-xs"
    />
  );

  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1 grid grid-cols-2 gap-1">
        {field(from, setFrom, fromLabel, t`none`)}
        {field(to, setTo, toLabel, t`none`)}
      </div>
    </div>
  );
}
