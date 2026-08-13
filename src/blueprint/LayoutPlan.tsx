/**
 * A layout drawn as a plan: a base on a build grid, on a sheet with clear ground
 * round it (issue #1506).
 *
 * The one drawing of a layout the app makes, used by the library card, by the
 * import and export drawers, and by the hub item page. The website draws a
 * shared layout with the same treatment in `components/ItemPreview.tsx` in
 * tomjn/coilbox-hub, so a base does not read one way there and another way here.
 *
 * The treatment is the welcome screen's blueprint illustration
 * (`../home/bundledArt.ts`), which read as a plan while this read as grey squares
 * floating in nothing. What comes across is the grid, the rounded corners, the
 * tinted fill on a stronger outline, and the order thread with its start dot.
 * What does not is the composition: that drawing is nine buildings somebody chose,
 * this one is whatever a person actually made, so every part of it has to hold
 * from a three building opening to a thirty building base.
 *
 * How each part holds:
 *
 * - The grid coarsens rather than crowding. `blueprintSheet` picks the pitch.
 * - Strokes are in pixels, not build squares, so a big base gets the same crisp
 *   hairline as a small one instead of a line thinner than the screen can draw.
 * - The order thread runs under the buildings. A base with a long build order
 *   would be a scribble drawn over the top, and underneath it shows through the
 *   fill as a route between plots and stays out of the way when it doubles back.
 * - A building the payload never sized is outlined and left unfilled, so a guess
 *   at one square does not read as a measurement.
 */

import { cn } from "@picoframe/frame";

import { type BlueprintShape, blueprintSheet } from "@/hub/preview";

/** How much colour each layer takes, in the illustration's order: a grid the eye
 *  skims, then a tinted fill under a stronger outline. */
const GRID = 0.14;
const FILL = 0.3;
const OUTLINE = 0.62;

/** The mark the order starts on, which is the brightest thing on the sheet. */
const START = 0.85;

/** Corner radius, in build squares. A tenth of a square, which is the corner the
 *  illustration puts on a plot, so a one square building rounds off the same
 *  amount in both drawings. */
const CORNER = 0.1;

/**
 * How strongly the order thread is drawn, given how many stops it makes.
 *
 * A short order is a line you can follow and it gets the illustration's weight. A
 * long one crosses its own path over and over, and at that length the thread
 * stops being a route and becomes texture, so it fades to where it says the base
 * has an order and where that order starts without drowning the base it runs
 * over.
 */
function threadOpacity(stops: number): number {
  return stops <= 8 ? 0.5 : Math.max(0.22, 0.5 - (stops - 8) * 0.012);
}

export function LayoutPlan({
  shape,
  className,
}: {
  shape: BlueprintShape;
  /** How big to draw it. The caller owns the size because a card and a page
   *  want very different ones. */
  className?: string;
}) {
  const sheet = blueprintSheet(shape);
  const centres = shape.squares.map(
    (square) =>
      [square.x + square.width / 2, square.y + square.height / 2] as const,
  );
  // A thread needs somewhere to go, and one building in build order is a
  // sequence of one.
  const thread = shape.ordered && centres.length > 1 ? centres : null;
  const start = thread ? centres[0] : null;

  return (
    <svg
      viewBox={`${sheet.left} ${sheet.top} ${sheet.width} ${sheet.height}`}
      className={cn("text-primary", className)}
      role="img"
      aria-label={`${shape.squares.length} buildings over ${Math.round(shape.width)} by ${Math.round(shape.height)} build squares`}
    >
      <g
        className="text-muted-foreground"
        stroke="currentColor"
        strokeOpacity={GRID}
      >
        {sheet.verticals.map((x) => (
          <line
            key={`v${x}`}
            x1={x}
            y1={sheet.top}
            x2={x}
            y2={sheet.top + sheet.height}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {sheet.horizontals.map((y) => (
          <line
            key={`h${y}`}
            x1={sheet.left}
            y1={y}
            x2={sheet.left + sheet.width}
            y2={y}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      {thread && (
        <path
          d={`M${thread.map(([x, y]) => `${x} ${y}`).join(" L")}`}
          fill="none"
          stroke="currentColor"
          strokeOpacity={threadOpacity(thread.length)}
          strokeWidth={1.5}
          strokeDasharray="3 5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {shape.squares.map((square) => (
        <rect
          // Keyed by where it stands, which is what makes it that building.
          key={`${square.def}@${square.x},${square.y}`}
          x={square.x}
          y={square.y}
          width={square.width}
          height={square.height}
          rx={CORNER}
          fill="currentColor"
          fillOpacity={square.sized ? FILL : 0}
          stroke="currentColor"
          strokeOpacity={OUTLINE}
          strokeWidth={1.25}
          strokeDasharray={square.sized ? undefined : "2 2"}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {start && (
        // Where the build order starts, drawn over the building it starts on.
        // Sized off the grid pitch rather than fixed, so it stays the same mark
        // against the rule whatever the base measures.
        <circle
          cx={start[0]}
          cy={start[1]}
          r={sheet.pitch * 0.22}
          fill="currentColor"
          fillOpacity={START}
        />
      )}
    </svg>
  );
}
