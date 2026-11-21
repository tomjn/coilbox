import { useLingui } from "@lingui/react/macro";
import { cn } from "@picoframe/frame";
import type { DemoInfo, StartBox } from "../../bindings";
import { NEUTRAL_TEAM_COLOUR, type StartDot } from "../../replayMapLayers";
import { teamLabel } from "../../replaySideLabel";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { swatch } from "./ReplayRoster";

/**
 * Where a side was allowed to start. Today an area is a rectangle, and the map
 * draws it as one. The area is the thing the two map modes share, so a polygon
 * from a Zero-K or Beyond All Reason start script can take the rectangle's
 * place in both by changing {@link StartAreas} alone.
 */
export interface StartArea {
  /** The ally team's number, from zero. */
  id: number;
  colour: string;
  /** As fractions of the map's width and height. */
  box: StartBox;
}

/** The start areas a replay's setup carries, in the colour of their side. */
export function startAreas(info: DemoInfo): StartArea[] {
  const out: StartArea[] = [];
  for (const a of info.allyTeams) {
    if (a.startBox)
      out.push({
        id: a.id,
        colour: swatch(a.color) ?? NEUTRAL_TEAM_COLOUR,
        box: a.startBox,
      });
  }
  return out;
}

const withAlpha = (colour: string, alpha: number) =>
  colour.replace("rgb", "rgba").replace(")", `, ${alpha})`);

/**
 * The start areas, each an outline in its side's colour with a light tint and
 * the side's number. Put it in the map's box, under whatever must stay in
 * front. With `named` a box has a tooltip and takes the pointer. Without, the
 * pointer goes through to what is beneath, which is how the unit map keeps a
 * unit inside a box pointable.
 */
export function StartAreas({
  areas,
  named,
}: {
  areas: readonly StartArea[];
  named: boolean;
}) {
  const { t } = useLingui();
  return areas.map(({ id, colour, box }) => {
    const boxTeam = teamLabel(id);
    return (
      <span
        key={id}
        data-layer="startBox"
        className={cn(
          "absolute flex items-start justify-start",
          !named && "pointer-events-none",
        )}
        style={{
          left: `${box.left * 100}%`,
          top: `${box.top * 100}%`,
          width: `${(box.right - box.left) * 100}%`,
          height: `${(box.bottom - box.top) * 100}%`,
          border: `1.5px solid ${colour}`,
          backgroundColor: withAlpha(colour, 0.22),
        }}
        title={named ? t`${boxTeam} start box` : undefined}
      >
        <span
          className="m-0.5 rounded px-1 text-[10px] font-medium leading-tight text-white"
          style={{ backgroundColor: withAlpha(colour, 0.85) }}
        >
          {id + 1}
        </span>
      </span>
    );
  });
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
