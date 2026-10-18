/**
 * A small square of a colourway's colour, beside its name in the inventory's
 * category menu and in the detail panel's colourway switch (#4538).
 */

import { cn } from "@picoframe/frame";

import type { ColourwayColours } from "../../colourwayColours";

/**
 * `colourway` absent is "All categories", drawn as an empty dashed square. A
 * colourway with no colour of its own shows every colour the pack has.
 */
export function ColourwayChip({
  colourway,
  colours,
  className,
}: {
  colourway?: string;
  colours: ColourwayColours;
  className?: string;
}) {
  const background =
    colourway === undefined ? undefined : chipBackground(colourway, colours);
  return (
    <span
      aria-hidden
      data-colourway={colourway}
      className={cn(
        "inline-block size-3 shrink-0 rounded-[3px] border border-white/15",
        colourway === undefined && "border-dashed border-muted-foreground/60",
        className,
      )}
      style={background ? { background } : undefined}
    />
  );
}

function chipBackground(
  colourway: string,
  colours: ColourwayColours,
): string | undefined {
  const own = colours.get(colourway);
  if (own) return own;
  const all = [...colours.values()];
  if (all.length === 0) return undefined;
  const step = 100 / all.length;
  const stops = all.map(
    (colour, i) => `${colour} ${i * step}% ${(i + 1) * step}%`,
  );
  return `linear-gradient(135deg, ${stops.join(", ")})`;
}
