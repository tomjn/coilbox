/**
 * A generated shape's numbers in the piece panel. A cylinder or a tube has the
 * axis it runs along, its radius, length, wall and sides (#3327). A cone has
 * its bottom and top radius, height and sides (#3329). A wedge has
 * its width, depth, height, the height of its low end and which way it slopes
 * (#3328). A sphere has its three radii (so it can be an ellipsoid), whether
 * it is whole, a dome or a bowl, and its rings and sides (#3330). A number the shape cannot take is refused with a line saying why,
 * and the shape keeps what it had. A shape with round ends can show the
 * pack's round panel on them (#4398), when the pack has one for its colourway.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { useEffect, useId, useState } from "react";

import { CheckField } from "@/components/Field";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  type RoundNumbers,
  roundNumbers,
  withRoundNumber,
} from "../../roundShape";
import {
  type LegoShape,
  roundPanelFor,
  SPHERE_BOWL,
  SPHERE_DOME,
  SPHERE_WHOLE,
} from "../../shapes";
import {
  type SphereNumbers,
  sphereNumbers,
  withSphereNumber,
} from "../../sphereShape";
import {
  type WedgeNumbers,
  wedgeNumbers,
  withWedgeNumber,
} from "../../wedgeShape";
import { AXES } from "./TransformFields";

interface Props {
  shape: LegoShape;
  onChange: (shape: LegoShape) => void;
}

export function ShapeFields({ shape, onChange }: Props) {
  if (shape.kind === "wedge") {
    return <WedgeFields shape={shape} onChange={onChange} />;
  }
  if (shape.kind === "sphere") {
    return <SphereFields shape={shape} onChange={onChange} />;
  }
  return <RoundFields shape={shape} onChange={onChange} />;
}

function SphereFields({ shape, onChange }: Props) {
  const { t } = useLingui();
  const numbers = sphereNumbers(shape);
  const [problem, setProblem] = useState<string | null>(null);

  function set(name: keyof SphereNumbers, value: number) {
    const result = withSphereNumber(shape, name, value);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    onChange(result.shape);
  }

  const whole = numbers.keep === SPHERE_WHOLE;
  const keeps = [
    { keep: SPHERE_WHOLE, label: t`Whole` },
    { keep: SPHERE_DOME, label: t`Dome` },
    { keep: SPHERE_BOWL, label: t`Bowl` },
  ];
  const fields: { name: keyof SphereNumbers; label: string }[] = [
    { name: "radiusX", label: t`Radius X` },
    { name: "radiusY", label: whole ? t`Radius Y` : t`Height` },
    { name: "radiusZ", label: t`Radius Z` },
    { name: "rings", label: t`Rings` },
    { name: "sides", label: t`Sides` },
  ];

  return (
    <div className="mt-2 flex flex-col gap-2">
      <ButtonGroup className="flex w-full" aria-label={t`Kept`}>
        {keeps.map(({ keep, label }) => (
          <Button
            key={keep}
            size="sm"
            variant={numbers.keep === keep ? "default" : "outline"}
            className="flex-1"
            aria-pressed={numbers.keep === keep}
            onClick={() => set("keep", keep)}
          >
            {label}
          </Button>
        ))}
      </ButtonGroup>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fields.map(({ name, label }) => (
          <ShapeNumber
            key={name}
            label={label}
            value={numbers[name]}
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

function WedgeFields({ shape, onChange }: Props) {
  const { t } = useLingui();
  const numbers = wedgeNumbers(shape);
  const [problem, setProblem] = useState<string | null>(null);

  function set(name: keyof WedgeNumbers, value: number) {
    const result = withWedgeNumber(shape, name, value);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    onChange(result.shape);
  }

  const fields: {
    name: "width" | "depth" | "height" | "low";
    label: string;
  }[] = [
    { name: "width", label: t`Width` },
    { name: "depth", label: t`Depth` },
    { name: "height", label: t`Height` },
    { name: "low", label: t`Low end` },
  ];
  const directions = [
    { flip: false, label: t`High at back` },
    { flip: true, label: t`High at front` },
  ];

  return (
    <div className="mt-2 flex flex-col gap-2">
      <ButtonGroup className="flex w-full" aria-label={t`Slope direction`}>
        {directions.map(({ flip, label }) => (
          <Button
            key={String(flip)}
            size="sm"
            variant={numbers.flip === flip ? "default" : "outline"}
            className="flex-1"
            aria-pressed={numbers.flip === flip}
            onClick={() => set("flip", flip ? 1 : 0)}
          >
            {label}
          </Button>
        ))}
      </ButtonGroup>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {fields.map(({ name, label }) => (
          <ShapeNumber
            key={name}
            label={label}
            value={numbers[name]}
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

function RoundFields({ shape, onChange }: Props) {
  const { t } = useLingui();
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

  const cone = shape.kind === "cone";
  const fields: { name: keyof RoundNumbers; label: string }[] = [
    { name: "radius", label: cone ? t`Bottom radius` : t`Radius` },
    ...(numbers.top === undefined
      ? []
      : [{ name: "top" as const, label: t`Top radius` }]),
    { name: "length", label: cone ? t`Height` : t`Length` },
    ...(numbers.wall === undefined
      ? []
      : [{ name: "wall" as const, label: t`Wall` }]),
    { name: "sides", label: t`Sides` },
  ];

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div>
        <span className="text-xs text-muted-foreground">
          <Trans>Axis</Trans>
        </span>
        <ButtonGroup className="mt-1 flex w-full" aria-label={t`Axis`}>
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
      {roundPanelFor(shape) ? (
        <CheckField
          label={t`Hub on ends`}
          checked={(shape.options?.hub ?? 0) !== 0}
          onChange={(on) => {
            const { hub: _hub, ...rest } = shape.options ?? {};
            onChange({ ...shape, options: on ? { ...rest, hub: 1 } : rest });
          }}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        <Trans>Dragging a round side sets the radius.</Trans>
      </p>
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
