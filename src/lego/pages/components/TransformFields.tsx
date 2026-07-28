/**
 * A piece's position, rotation and scale as numbers you can type.
 *
 * The gizmo is for placing something roughly where it looks right. These are
 * for the times that is not good enough: matching two legs, squaring a piece
 * to an axis, or scaling by exactly two.
 *
 * Each field holds what you type until you leave it, so a half-typed "1." or
 * "-" is not parsed as you go and does not snap the piece somewhere odd
 * mid-keystroke. Rotation is shown in degrees and stored in radians.
 */

import { Button, Input } from "@picoframe/frame";
import { Link, Unlink } from "lucide-react";
import { useEffect, useState } from "react";

import type { LegoPiece } from "../../model";

type Vec3 = [number, number, number];

interface Props {
  piece: LegoPiece;
  onChange: (change: Partial<LegoPiece>) => void;
  /** Scale keeps its proportions, for the gizmo as well as these fields. */
  uniformScale: boolean;
  onUniformScaleChange: (uniform: boolean) => void;
}

/**
 * The gizmo's own axis colours, lightened.
 *
 * `TransformControls` draws X red, Y green and Z blue. Its handles are fully
 * saturated, which is unreadable as small text on a dark panel, so these are
 * the same hues at a lighter tone: the field and the arrow you dragged are
 * recognisably the same axis.
 */
const AXES = [
  { label: "X", colour: "#f87171" },
  { label: "Y", colour: "#4ade80" },
  { label: "Z", colour: "#60a5fa" },
] as const;

export function TransformFields({
  piece,
  onChange,
  uniformScale,
  onUniformScaleChange,
}: Props) {
  function setAxis(
    field: "position" | "rotation" | "scale",
    axis: number,
    value: number,
  ) {
    const next: Vec3 = [...piece[field]];
    if (field === "scale" && uniformScale) {
      // Keep the proportions the piece already has rather than forcing every
      // axis to the same number, which would undo a deliberate stretch.
      const from = piece.scale[axis];
      const ratio = from === 0 ? 1 : value / from;
      onChange({
        scale: [
          piece.scale[0] * ratio,
          piece.scale[1] * ratio,
          piece.scale[2] * ratio,
        ],
      });
      return;
    }
    next[axis] = value;
    onChange({ [field]: next });
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <Row
        label="Position"
        values={piece.position}
        onCommit={(axis, value) => setAxis("position", axis, value)}
      />
      <Row
        label="Rotation"
        unit="°"
        values={piece.rotation.map(toDegrees) as Vec3}
        onCommit={(axis, value) =>
          setAxis("rotation", axis, (value * Math.PI) / 180)
        }
      />
      <Row
        label="Scale"
        values={piece.scale}
        onCommit={(axis, value) => setAxis("scale", axis, value)}
        action={
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            onClick={() => onUniformScaleChange(!uniformScale)}
            aria-pressed={uniformScale}
            title={
              uniformScale
                ? "Scaling keeps its proportions. Click to scale one axis at a time"
                : "Scaling each axis on its own. Click to keep proportions"
            }
          >
            {uniformScale ? <Link size={12} /> : <Unlink size={12} />}
          </Button>
        }
      />
    </div>
  );
}

function Row({
  label,
  values,
  unit,
  onCommit,
  action,
}: {
  label: string;
  values: Vec3;
  unit?: string;
  onCommit: (axis: number, value: number) => void;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {label}
          {unit ? ` (${unit})` : ""}
        </span>
        {action}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {AXES.map((axis, index) => (
          <NumberField
            key={axis.label}
            value={values[index]}
            axis={axis.label}
            colour={axis.colour}
            label={`${label} ${axis.label}`}
            onCommit={(value) => onCommit(index, value)}
          />
        ))}
      </div>
    </div>
  );
}

function NumberField({
  value,
  axis,
  colour,
  label,
  onCommit,
}: {
  value: number;
  axis: string;
  colour: string;
  label: string;
  onCommit: (value: number) => void;
}) {
  const shown = round(value);
  const [draft, setDraft] = useState(shown);

  // Follow the document when it changes underneath, which is what dragging the
  // gizmo or selecting another piece looks like from here.
  useEffect(() => setDraft(shown), [shown]);

  function commit() {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(shown);
      return;
    }
    if (parsed !== value) onCommit(parsed);
  }

  return (
    // The letter sits inside the field rather than above it. Three extra rows
    // of labels in a 288px panel costs more than it explains.
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold"
        style={{ color: colour }}
      >
        {axis}
      </span>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(shown);
        }}
        inputMode="decimal"
        aria-label={label}
        className="h-7 pl-5 pr-1 text-right text-xs"
      />
    </div>
  );
}

/** Short enough to fit three to a row, precise enough to place a piece. */
function round(value: number): string {
  return String(Number(value.toFixed(3)));
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
