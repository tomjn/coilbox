/**
 * A skeleton's proportions as numbers and sliders (issue #3253).
 *
 * The viewport's handles edit the same values. A slider or a handle shows the
 * result live without making an edit, and one edit is made when it is let go.
 * A typed number is one edit when the field is left. A value outside the
 * plan's range is held to it, and the field says so.
 *
 * A count that would delete bones carrying a part, a mesh or a hung piece asks
 * first, naming the bones.
 */

import { Button, Input } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import {
  type BodyPlan,
  type BodyPlanProportion,
  bonesLostWithParts,
  planProportions,
} from "../../bodyPlans";
import type { LegoPiece, LegoProject } from "../../model";
import { clampProportion } from "../../skeletonEdit";

interface Props {
  project: LegoProject;
  plan: BodyPlan;
  /** One edit, for the whole set of values given. */
  onChange: (values: Record<string, number>) => void;
  /** Shows a value on screen without editing, or null to stop showing it. */
  onPreview: (preview: { id: string; value: number } | null) => void;
  /** The value being dragged by a viewport handle, if one is. */
  preview: { id: string; value: number } | null;
}

export function ProportionsPanel({
  project,
  plan,
  onChange,
  onPreview,
  preview,
}: Props) {
  const values = planProportions(plan, project.skeleton?.proportions);
  const [held, setHeld] = useState<string | null>(null);
  const [asking, setAsking] = useState<{
    id: string;
    value: number;
    lost: LegoPiece[];
  } | null>(null);

  function commit(proportion: BodyPlanProportion, typed: number) {
    const { value, held: wasHeld } = clampProportion(proportion, typed);
    setHeld(wasHeld ? proportion.id : null);
    onPreview(null);
    if (value === values[proportion.id]) return;
    const lost = bonesLostWithParts(project, plan, { [proportion.id]: value });
    if (lost.length > 0) {
      setAsking({ id: proportion.id, value, lost });
      return;
    }
    setAsking(null);
    onChange({ [proportion.id]: value });
  }

  if (plan.proportions.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        This plan has nothing to size.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      <p className="text-xs text-muted-foreground">
        {plan.label}. Drag a handle in the view or set a number.
      </p>
      {plan.proportions.map((proportion) => {
        const shown =
          preview?.id === proportion.id ? preview.value : values[proportion.id];
        return (
          <ProportionRow
            key={proportion.id}
            proportion={proportion}
            value={shown}
            held={held === proportion.id}
            onType={(typed) => commit(proportion, typed)}
            onSlide={(slid) => {
              // A count changes bones, so it is not shown until it is let go.
              if (proportion.unit !== "count")
                onPreview({ id: proportion.id, value: slid });
            }}
            onSlideEnd={(slid) => commit(proportion, slid)}
          />
        );
      })}
      {asking ? (
        <div
          role="alert"
          className="rounded border border-destructive/50 p-2 text-xs"
        >
          <p>
            This removes {asking.lost.map((piece) => piece.name).join(", ")} and
            what is on {asking.lost.length === 1 ? "it" : "them"}.
          </p>
          <div className="mt-2 flex gap-1">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                onChange({ [asking.id]: asking.value });
                setAsking(null);
              }}
            >
              Remove
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAsking(null)}>
              Keep
            </Button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        A bone you moved by hand goes back to the plan when a proportion that
        places it changes.
      </p>
    </div>
  );
}

function ProportionRow({
  proportion,
  value,
  held,
  onType,
  onSlide,
  onSlideEnd,
}: {
  proportion: BodyPlanProportion;
  value: number;
  held: boolean;
  onType: (value: number) => void;
  onSlide: (value: number) => void;
  onSlideEnd: (value: number) => void;
}) {
  const shown = String(Number(value.toFixed(3)));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const [sliding, setSliding] = useState<number | null>(null);

  function leave() {
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed)) {
      setText(shown);
      return;
    }
    if (parsed !== value) onType(parsed);
    else setText(shown);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label
          className="text-xs text-muted-foreground"
          htmlFor={`proportion-${proportion.id}`}
        >
          {proportion.label}
          {proportion.unit === "elmo" ? " (elmos)" : ""}
        </label>
        <Input
          id={`proportion-${proportion.id}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={leave}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setText(shown);
          }}
          inputMode="decimal"
          className="h-7 w-20 px-1 text-right text-xs"
        />
      </div>
      <Slider
        className="mt-2"
        aria-label={`Slide ${proportion.label}`}
        min={proportion.min}
        max={proportion.max}
        step={proportion.step}
        value={[sliding ?? value]}
        onValueChange={([slid]) => {
          setSliding(slid);
          onSlide(slid);
        }}
        onValueCommit={([slid]) => {
          setSliding(null);
          onSlideEnd(slid);
        }}
      />
      {held ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Held to {proportion.min} to {proportion.max}.
        </p>
      ) : null}
    </div>
  );
}
