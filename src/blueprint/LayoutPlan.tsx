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
 * - Every mark is sized in pixels rather than in build squares, so the drawing
 *   holds its weight from a forty pixel thumbnail to a page wide plan instead of
 *   scaling with the base until it is a hairline or a blob. That needs the box it
 *   is drawn in, which is why this measures itself.
 * - The grid fades rather than crowding. `blueprintSheet` rules every build
 *   square, so a big base gets more rules, drawn lighter.
 * - Strokes are in pixels, not build squares, so a big base gets the same crisp
 *   hairline as a small one instead of a line thinner than the screen can draw.
 * - The order thread runs under the buildings. A base with a long build order
 *   would be a scribble drawn over the top, and underneath it shows through the
 *   fill as a route between plots and stays out of the way when it doubles back.
 * - A building the payload never sized is outlined and left unfilled, so a guess
 *   at one square does not read as a measurement.
 *
 * A building the caller has a picture of is drawn as that unit, seen from above
 * (issue #1721). The picture sits in the ground the building stands on, the
 * outline stays over it, and the grid still runs under everything, so a plan with
 * pictures in it is still a plan and still reads against the grid rather than
 * becoming a screenshot. Where the pictures come from is
 * `@/hub/assets/unitPictures.ts`. This file is handed them and fetches nothing,
 * because the same drawing is used by a card, by a drawer and by the hub page.
 */

import { cn } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";

import type { PlanPicture } from "@/hub/assets/unitPictures";
import {
  type BlueprintShape,
  type BlueprintSheet,
  blueprintSheet,
  type PlanBox,
  pictureBox,
  planLabel,
  SHEET_MARGIN,
} from "@/hub/preview";

/** How much colour each layer takes, in the illustration's order: a grid the eye
 *  skims, then a tinted fill under a stronger outline. */
const GRID = 0.14;
const FILL = 0.3;
const OUTLINE = 0.62;

/** The mark the order starts on, which is the brightest thing on the sheet. */
const START = 0.85;

/** How big a build square has to be drawn for the grid to take its full weight,
 *  in CSS pixels. Under that the rules are closer together, so they are drawn
 *  lighter in proportion and the sheet keeps the same amount of ink on it rather
 *  than darkening as the base grows. */
const CLEAR_PX = 8;

/**
 * Corner radius, in CSS pixels.
 *
 * The illustration this drawing takes its treatment from rounds a plot by two
 * pixels, on a sheet whose build squares are twenty pixels across. Carried over as
 * a tenth of a build square it came to under a pixel on a library card, where a
 * build square is nearer five, and the buildings read as hard squares (issue
 * #1508). Two pixels is the same corner the illustration draws, at whatever size
 * this one is drawn.
 */
const CORNER_PX = 2;

/** The most of a building the corners may eat. A radius fixed in pixels would
 *  round a one square building drawn small into a lozenge. */
const CORNER_SHARE = 1 / 3;

/** How big the mark on the first building is, in CSS pixels: a fifth of a build
 *  square where there is room, and never so small it is lost or so big it covers
 *  the building it stands on. */
const START_PX = { share: 0.22, least: 2, most: 4.5 };

/**
 * What a build square is drawn at before the box is measured, in CSS pixels.
 *
 * Eight is where the grid takes its full weight, so what this draws is the layout
 * on a sheet of its own shape: the base, its clear ground, and nothing beyond.
 * That is the drawing without the box, which is the most that can be said before
 * anything has said how big the box is, and it is what renders where there is no
 * browser to measure with.
 */
const NOMINAL_PX_PER_SQUARE = 8;

/** The box to draw in until the real one is known. */
function nominalBox(shape: BlueprintShape): PlanBox {
  return {
    width: (shape.width + SHEET_MARGIN * 2) * NOMINAL_PX_PER_SQUARE,
    height: (shape.height + SHEET_MARGIN * 2) * NOMINAL_PX_PER_SQUARE,
  };
}

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
  pictures,
}: {
  shape: BlueprintShape;
  /** How big to draw it. The caller owns the size because a card and a page
   *  want very different ones, and it has to settle both sides of the box: the
   *  sheet is the whole of it, so a box with no height has no sheet. */
  className?: string;
  /** A picture per building, keyed on the lower cased def, from
   *  `useHeldUnitPictures`. A def with no entry is drawn as its square. */
  pictures?: ReadonlyMap<string, PlanPicture>;
}) {
  const [box, setBox] = useState<PlanBox | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  // Measured rather than assumed, because a card's width is whatever the column
  // it landed in is.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setBox((was) =>
        was?.width === width && was?.height === height
          ? was
          : { width, height },
      );
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={frame} className={cn("text-primary", className)}>
      <Sheet
        shape={shape}
        box={box ?? nominalBox(shape)}
        pictures={pictures ?? EMPTY}
      />
    </div>
  );
}

/** No pictures, as one value rather than one per render. */
const EMPTY: ReadonlyMap<string, PlanPicture> = new Map();

/** The plan itself, drawn once the box it goes in is known. */
function Sheet({
  shape,
  box,
  pictures,
}: {
  shape: BlueprintShape;
  box: PlanBox;
  pictures: ReadonlyMap<string, PlanPicture>;
}) {
  const sheet = blueprintSheet(shape, box);
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
      className="block size-full"
      role="img"
      aria-label={planLabel(shape)}
    >
      <g
        className="text-muted-foreground"
        stroke="currentColor"
        strokeOpacity={gridOpacity(sheet.scale)}
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
      {/* Every picture before any outline, rather than a picture and its outline
          per building. A render's box reaches a build square past the footprint
          on each side, so interleaved the next building's transparent bleed would
          be drawn over the last one's outline. */}
      {shape.squares.map((square) => {
        const picture = pictures.get(square.def.toLowerCase());
        if (!picture) return null;
        const box = pictureBox(square, { framed: picture.framed });
        return (
          <image
            key={`p${square.def}@${square.x},${square.y}`}
            href={picture.url}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            // A framed render is already the box's own aspect, so this only bites
            // on a build pic standing in for one, which is square.
            preserveAspectRatio="xMidYMid meet"
          />
        );
      })}
      {shape.squares.map((square) => (
        <rect
          // Keyed by where it stands, which is what makes it that building.
          key={`${square.def}@${square.x},${square.y}`}
          x={square.x}
          y={square.y}
          width={square.width}
          height={square.height}
          rx={corner(sheet, square.width, square.height)}
          fill="currentColor"
          // A building showing its own picture needs no tint under it, and one
          // the payload never sized keeps its empty outline.
          fillOpacity={
            pictures.has(square.def.toLowerCase()) || !square.sized ? 0 : FILL
          }
          stroke="currentColor"
          strokeOpacity={OUTLINE}
          strokeWidth={1.25}
          strokeDasharray={square.sized ? undefined : "2 2"}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {start && (
        // Where the build order starts, drawn over the building it starts on.
        <circle
          cx={start[0]}
          cy={start[1]}
          r={startMark(sheet)}
          fill="currentColor"
          fillOpacity={START}
        />
      )}
    </svg>
  );
}

/** The grid's weight at the size it is drawn. The rules close up as a base grows,
 *  so they lighten in step and the sheet holds the same amount of ink instead of
 *  darkening towards a wash. */
function gridOpacity(scale: number): number {
  return GRID * Math.min(1, scale / CLEAR_PX);
}

/** A building's corner radius, in build squares, from a radius in pixels. Capped
 *  against the building's short side, so a small building softens rather than
 *  rounding away. */
function corner(sheet: BlueprintSheet, width: number, height: number): number {
  return Math.min(
    CORNER_PX / sheet.scale,
    Math.min(width, height) * CORNER_SHARE,
  );
}

/** The start mark's radius, in build squares, from a size in pixels. */
function startMark(sheet: BlueprintSheet): number {
  const px = Math.min(
    START_PX.most,
    Math.max(START_PX.least, sheet.scale * START_PX.share),
  );
  return px / sheet.scale;
}
