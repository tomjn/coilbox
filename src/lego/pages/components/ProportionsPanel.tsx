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
 *
 * A skeleton fitted to pieces the unit already had (#3261) is shown and not
 * edited.
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
import type { LegoPiece, LegoProject, SkeletonTarget } from "../../model";
import { clampProportion } from "../../skeletonEdit";
import {
  currentTarget,
  describeSize,
  overTarget,
  skeletonSize,
} from "../../skeletonSize";
import { SkeletonTargetFields } from "./SkeletonTargetFields";

interface Props {
  project: LegoProject;
  plan: BodyPlan;
  /** One edit, for the whole set of values given. */
  onChange: (values: Record<string, number>) => void;
  /** Shows a value on screen without editing, or null to stop showing it. */
  onPreview: (preview: { id: string; value: number } | null) => void;
  /** Fits the skeleton to a footprint and height and keeps them as its target,
   *  as one edit. */
  onTarget: (target: SkeletonTarget) => void;
  /** The value being dragged by a viewport handle, if one is. */
  preview: { id: string; value: number } | null;
}

export function ProportionsPanel({
  project,
  plan,
  onChange,
  onPreview,
  onTarget,
  preview,
}: Props) {
  if (project.skeleton?.fitted) {
    return (
      <FittedProportions plan={plan} measured={project.skeleton.proportions} />
    );
  }
  return (
    <PlanProportions
      project={project}
      plan={plan}
      onChange={onChange}
      onPreview={onPreview}
      onTarget={onTarget}
      preview={preview}
    />
  );
}

/**
 * A skeleton fitted to the unit's own pieces (#3261) shows what was measured
 * and nothing to change: changing a proportion would move pieces the game
 * maker placed by hand.
 */
function FittedProportions({
  plan,
  measured,
}: {
  plan: BodyPlan;
  measured: Record<string, number>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
      <p className="text-xs text-muted-foreground">
        {plan.label}, fitted to this unit's pieces
      </p>
      <dl className="space-y-1 text-xs">
        {plan.proportions.map((proportion) => {
          const value = measured[proportion.id];
          return (
            <div key={proportion.id} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{proportion.label}</dt>
              <dd>
                {value === undefined
                  ? "Not measured"
                  : proportion.unit === "elmo"
                    ? `${Number(value.toFixed(3))} elmos`
                    : String(value)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function PlanProportions({
  project,
  plan,
  onChange,
  onPreview,
  onTarget,
  preview,
}: Props) {
  const values = planProportions(plan, project.skeleton?.proportions);
  const shownValues =
    preview && preview.id in values
      ? { ...values, [preview.id]: preview.value }
      : values;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      <p className="text-xs text-muted-foreground">
        {plan.proportions.length > 0
          ? `${plan.label}. Drag a handle in the view or set a number.`
          : plan.label}
      </p>
      <SizeSection
        plan={plan}
        values={shownValues}
        target={project.skeleton?.target}
        onTarget={onTarget}
      />
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

const AXIS_NAMES = { x: "width", z: "length", height: "height" } as const;

/** The skeleton's size, the target it is meant to stay within, and the fields
 *  to fit it to a new one. */
function SizeSection({
  plan,
  values,
  target,
  onTarget,
}: {
  plan: BodyPlan;
  values: Record<string, number>;
  target: SkeletonTarget | undefined;
  onTarget: (target: SkeletonTarget) => void;
}) {
  const size = skeletonSize(plan, values, target);
  const over = target ? overTarget(size, target) : [];
  const initial = target ?? currentTarget(plan, values);
  const where = over.map((axis) => AXIS_NAMES[axis]).join(" and ");
  return (
    <div className="space-y-2">
      <p className="text-xs">Size {describeSize(size)}</p>
      {over.length > 0 ? (
        <p className="text-xs text-destructive">Past the target in {where}.</p>
      ) : null}
      <FitFields
        key={JSON.stringify(initial)}
        initial={initial}
        onTarget={onTarget}
      />
    </div>
  );
}

/** The target fields and the button that fits to what is typed. Keyed by the
 *  target they start from, so a new one starts them over. */
function FitFields({
  initial,
  onTarget,
}: {
  initial: SkeletonTarget;
  onTarget: (target: SkeletonTarget) => void;
}) {
  const [typed, setTyped] = useState<SkeletonTarget | null>(initial);
  return (
    <>
      <SkeletonTargetFields initial={initial} onChange={setTyped} />
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={!typed}
          onClick={() => typed && onTarget(typed)}
        >
          Fit
        </Button>
      </div>
    </>
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
