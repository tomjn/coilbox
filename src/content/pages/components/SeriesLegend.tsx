import { Toggle } from "@/components/ui/toggle";
import { isEmphasised, type TeamSet } from "../../seriesEmphasis";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";

/**
 * The chart's legend for a match with too many lines to name at their ends.
 *
 * Each entry is a toggle rather than the plain swatch recharts draws, so it can
 * be reached by Tab and operated by Enter or Space. Pressing it keeps that line
 * emphasised, which is what `aria-pressed` reports. Hovering or focusing it
 * lights the line for as long as it lasts (#1139).
 *
 * The swatch keeps the line's own colour. Emphasis changes how a line is
 * drawn, never what colour it is, so the entry stays findable.
 */
export interface LegendEntry {
  id: string;
  label: string;
  color: string;
  teams: TeamSet;
}

export function SeriesLegend({ entries }: { entries?: LegendEntry[] }) {
  const e = useSeriesEmphasis();
  if (!entries) return null;
  // Held down by a click or press only. The pointer resting on an entry, or
  // "Highlight me", light it without pressing it.
  const held = { ...e.state, hovered: null, resting: null };
  return (
    <ul className="m-0 flex list-none flex-wrap justify-center gap-x-1 gap-y-0 p-0 text-xs">
      {entries.map((s) => {
        const lit = e.isLit(s.teams);
        return (
          <li key={s.id}>
            <Toggle
              size="sm"
              data-emphasised={lit}
              className={`gap-1.5 text-xs font-normal ${
                lit ? "ring-2 ring-ring/40" : e.dimming ? "opacity-50" : ""
              }`}
              pressed={isEmphasised(held, s.teams)}
              onPressedChange={() => e.toggleSelected(s.teams)}
              {...e.pointTo(s.teams)}
              {...e.focusOn(s.teams)}
            >
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              {s.label}
            </Toggle>
          </li>
        );
      })}
    </ul>
  );
}
