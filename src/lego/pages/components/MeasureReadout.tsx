/**
 * What the measure tool and a drag read out, in elmos and in steps.
 *
 * Each line also carries its length at its middle (`measureLayer.ts`). The
 * list beside the model keeps the length on each axis, which would crowd the
 * line.
 */

import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";

import {
  axesText,
  figure,
  lineLabel,
  type MeasuredLine,
  measureBetween,
  pieceSize,
} from "../../measure";
import type { LegoProject } from "../../model";
import { type LoadedPack, partUnit } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import type { Vec3 } from "../../snapping";
import type { MeasureLinesStore } from "./useMeasure";

/** Three lengths on one axis each, as two short lines. */
export function AxisFigures({
  values,
  step,
}: {
  values: Vec3;
  step: number | null;
}) {
  const { elmos, steps } = axesText(values, step);
  return (
    <>
      <div>
        <Trans>{elmos} elmos</Trans>
      </div>
      {steps ? (
        <div>
          <Trans>{steps} steps</Trans>
        </div>
      ) : null}
    </>
  );
}

const card =
  "pointer-events-auto self-start rounded-md bg-black/60 px-2 py-1.5 text-xs text-white";

/** The readout for the lines where the scene last drew them. */
export function LiveMeasureReadout({
  store,
  step,
  onClear,
}: {
  store: MeasureLinesStore;
  step: number | null;
  onClear: () => void;
}) {
  const { lines, pending } = useSyncExternalStore(store.subscribe, store.get);
  return (
    <MeasureReadout
      measurements={lines}
      start={pending?.from ?? null}
      hover={pending?.to ?? null}
      step={step}
      onClear={onClear}
    />
  );
}

/** The lines drawn, one block each, and the one being made. */
export function MeasureReadout({
  measurements,
  start,
  hover,
  step,
  onClear,
}: {
  /** Each measurement with its ends where they are now. */
  measurements: MeasuredLine[];
  /** The first point of a measurement waiting for its second. */
  start: Vec3 | null;
  /** Where the pointer is while it waits. */
  hover: Vec3 | null;
  step: number | null;
  onClear: () => void;
}) {
  const live = start && hover ? measureBetween(start, hover) : null;
  return (
    <div className={`${card} max-h-48 min-w-48 overflow-y-auto`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">
          <Trans>Measure</Trans>
        </span>
        {measurements.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1 text-xs"
            onClick={onClear}
          >
            <X size={12} /> <Trans>Clear</Trans>
          </Button>
        ) : null}
      </div>
      {measurements.map((m, index) => {
        const { delta } = measureBetween(m.from, m.to);
        return (
          <div key={m.id} className="mt-1 border-t border-white/20 pt-1">
            <div>
              {index + 1}. {lineLabel(m.from, m.to, step)}
            </div>
            <AxisFigures values={delta} step={step} />
          </div>
        );
      })}
      {start ? (
        <div className="mt-1 border-t border-white/20 pt-1">
          {live ? (
            <>
              <div>{figure(live.length, step)}</div>
              <AxisFigures values={live.delta} step={step} />
            </>
          ) : (
            <div>
              <Trans>Click the second point</Trans>
            </div>
          )}
        </div>
      ) : measurements.length === 0 ? (
        <div className="mt-1">
          <Trans>Click the first point</Trans>
        </div>
      ) : null}
    </div>
  );
}

/** How far the piece being dragged has moved, and how big it is. */
export function DragReadout({
  moved,
  size,
  step,
}: {
  moved: Vec3;
  size: Vec3 | null;
  step: number | null;
}) {
  return (
    <div className={card}>
      <div className="font-medium">
        <Trans>Moved</Trans>
      </div>
      <AxisFigures values={moved} step={step} />
      {size ? (
        <>
          <div className="mt-1 font-medium">
            <Trans>Size</Trans>
          </div>
          <AxisFigures values={size} step={step} />
        </>
      ) : null}
    </div>
  );
}

/**
 * A piece's size along each axis with the fields in the piece panel. A
 * component of its own so the bake it asks for is redone when the unit
 * changes and not on every render of the page.
 */
export function PieceSize({
  project,
  pack,
  raw,
  pieceId,
}: {
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  pieceId: string;
}) {
  const size = useMemo(
    () => pieceSize(project, pack, raw, pieceId),
    [project, pack, raw, pieceId],
  );
  if (!size) return null;
  return (
    <div className="mt-2">
      <span className="text-xs text-muted-foreground">
        <Trans>Size</Trans>
      </span>
      <div className="mt-1 text-xs">
        <AxisFigures values={size} step={partUnit(pack)} />
      </div>
    </div>
  );
}
