import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { StepBack, StepForward } from "lucide-react";
import type { ReactNode } from "react";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * The row that scrubs a preview: a step back button, a slider over the frames,
 * a step forward button and what frame it is on, beside them. The Animation panel scrubs a
 * script run with it, and the Timeline tab uses it as its ruler.
 *
 * `frame` and `lastFrame` are the slider's own value and last position, from
 * 0. Whatever sits under the slider goes in `children`, in the slider's column,
 * so it lines up with the thumb. `rows` and `labels` are a second grid row for
 * the tab's pieces, with `labels` in the column of the step back button.
 */
export function FrameScrubber({
  frame,
  lastFrame,
  onSeek,
  onStep,
  ariaLabel,
  readout,
  children,
  rows,
  labels,
  stickyRuler,
  className,
}: {
  frame: number;
  lastFrame: number;
  onSeek: (frame: number) => void;
  /** One frame back or forward. The caller pauses first, since a step only
   *  means anything on a held frame. */
  onStep: (delta: number) => void;
  ariaLabel: string;
  readout?: ReactNode;
  children?: ReactNode;
  rows?: ReactNode;
  labels?: ReactNode;
  /** Keeps the slider row at the top while the rows under it scroll. */
  stickyRuler?: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const ruler = stickyRuler ? "sticky top-0 z-10 bg-background" : undefined;
  return (
    <div
      className={cn(
        "grid items-start gap-x-2 gap-y-1",
        readout
          ? "grid-cols-[auto_1fr_auto_auto]"
          : "grid-cols-[auto_1fr_auto]",
        className,
      )}
    >
      <Button
        size="sm"
        variant="ghost"
        className={cn("justify-self-end", ruler)}
        disabled={frame <= 0}
        onClick={() => onStep(-1)}
        title={t`Step back one frame`}
        aria-label={t`Step back one frame`}
      >
        <StepBack size={14} />
      </Button>
      <div className={cn("flex min-w-0 flex-col gap-1", ruler)}>
        <Slider
          min={0}
          max={Math.max(lastFrame, 0)}
          step={1}
          value={[frame]}
          onValueChange={([next]) => onSeek(next)}
          aria-label={ariaLabel}
          // Match the h-8 step buttons so the row can go items-start:
          // with marks underneath, the column is taller than the
          // buttons, and items-center would otherwise centre the
          // buttons 14px below the thumb.
          className="h-8"
        />
        {children}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className={ruler}
        disabled={frame >= lastFrame}
        onClick={() => onStep(1)}
        title={t`Step forward one frame`}
        aria-label={t`Step forward one frame`}
      >
        <StepForward size={14} />
      </Button>
      {/* Beside the step buttons, where the eye already is while scrubbing,
          rather than under every row of the tab. */}
      {readout ? (
        <span
          className={cn(
            "flex h-8 items-center rounded-md border border-border px-2 text-sm font-medium tabular-nums",
            ruler,
          )}
        >
          {readout}
        </span>
      ) : null}
      {rows !== undefined ? (
        <>
          <div className="flex min-w-0 flex-col">{labels}</div>
          <div className="flex min-w-0 flex-col">{rows}</div>
          <div />
          {readout ? <div /> : null}
        </>
      ) : null}
    </div>
  );
}
