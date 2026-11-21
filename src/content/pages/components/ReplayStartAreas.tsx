import { cn } from "@picoframe/frame";
import { StartPolygonOverlay } from "@/startbox/StartPolygonOverlay";
import type { StartDot } from "../../replayMapLayers";
import type { StartAreaSet } from "../../replayStartAreas";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";

/**
 * The start areas, each an outline in its side's colour with a light tint and
 * the side's number. Put it in the map's box, under whatever must stay in
 * front. The areas are polygons, which a replay's rectangles are too, so a
 * Zero-K or Beyond All Reason shape draws here as the rectangle does and both
 * map modes share it. With `named` an area's number has a tooltip and takes the
 * pointer. Without, the pointer goes through to what is beneath, which is how
 * the unit map keeps a unit inside an area pointable.
 */
export function StartAreas({
  set,
  named,
}: {
  set: StartAreaSet;
  named: boolean;
}) {
  return (
    <StartPolygonOverlay
      areas={set.areas}
      extent={set.extent}
      named={named}
      labelAt="corner"
    />
  );
}

/** The round mark of one start position. Emphasis is a ring and a fade, never a
 *  change of colour. */
export function StartDotMark({
  dot,
  lit,
  dimming,
}: {
  dot: StartDot;
  lit: boolean;
  dimming: boolean;
}) {
  return (
    <span
      className={cn(
        "block size-3 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(9,13,22,0.9)] transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-ring",
        lit && "ring-2 ring-white ring-offset-2 ring-offset-black/80",
        dot.isMe && !lit && "outline-2 outline-offset-2 outline-white",
        dimming && !lit && "opacity-40",
      )}
      style={{ backgroundColor: dot.colour }}
    />
  );
}

/**
 * The start positions as marks that cannot be pressed, for the unit map, where
 * a button over the canvas would hide the units under it and take the pointer
 * from them. They follow the players table's emphasis like the flat map's dots.
 */
export function StartDotMarks({ dots }: { dots: readonly StartDot[] }) {
  const { isLit, dimming } = useSeriesEmphasis();
  return dots.map((dot) => (
    <span
      key={dot.team}
      aria-hidden="true"
      data-layer="startDot"
      data-team={dot.team}
      className="pointer-events-none absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ left: `${dot.left * 100}%`, top: `${dot.top * 100}%` }}
    >
      <StartDotMark dot={dot} lit={isLit([dot.team])} dimming={dimming} />
    </span>
  ));
}
