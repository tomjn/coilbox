import { heatGradientCss } from "@/lib/heatRamp";

/**
 * The key to a heatmap: the ramp from least to most, and what "most" is.
 *
 * A heatmap is drawn against its own brightest point, so the colours say where
 * and never how much. `peak` is the sentence that puts the amount back, such
 * as "37 buildings ordered within 256 elmos". Every heatmap needs one: the
 * same colours over one match and over fifty mean different things, and this
 * line is the only place that says which. That the colours compare places on
 * one map with each other, and not with another picture, is in the help of the
 * section that draws the legend.
 */
export function HeatLegend({
  label,
  peak,
}: {
  /** What is being counted, such as "Buildings ordered". */
  label: string;
  /** What the brightest point stands for, in words. */
  peak: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span>Least</span>
        {/* Over a mid grey and not the card, because the ramp is drawn over a
         * map and its faint end would vanish against a card of either theme. */}
        <span
          aria-hidden
          className="h-3 w-32 rounded-sm border border-border/50 bg-neutral-500"
        >
          <span
            className="block size-full rounded-sm"
            style={{ backgroundImage: heatGradientCss() }}
          />
        </span>
        <span>Most</span>
      </div>
      <span>Most is {peak}.</span>
    </div>
  );
}
