import { Crosshair } from "lucide-react";
import type { ReactNode } from "react";
import { Toggle } from "@/components/ui/toggle";
import { isEmphasised } from "../../seriesEmphasis";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";

/**
 * One seat in the roster, wired to the emphasised series (#1139).
 *
 * Pointing at the row lights its line on the chart, and the line or the legend
 * entry lights the row. The toggle at the end is the way in without a pointer:
 * it holds the seat's line lit until it is pressed again, and exposes that as
 * `aria-pressed`. A seat whose team has no line, or any seat before the chart
 * has loaded or when statistics are hidden, gets a plain row with no toggle.
 */
export function SeatItem({
  team,
  name,
  children,
}: {
  team: number | undefined;
  name: string;
  children: ReactNode;
}) {
  const e = useSeriesEmphasis();
  if (team === undefined || !e.isCharted(team)) {
    return <li className="flex items-center gap-2 py-1">{children}</li>;
  }
  const teams = [team];
  const lit = e.isLit(teams);
  return (
    <li
      data-emphasised={lit}
      className={`-mx-1 flex items-center gap-2 rounded-md px-1 py-1 ${
        lit ? "bg-accent/60 ring-2 ring-ring/40" : ""
      }`}
      {...e.pointTo(teams)}
    >
      {children}
      <Toggle
        size="sm"
        aria-label={`Highlight ${name} on the chart`}
        title={`Highlight ${name} on the chart`}
        pressed={isEmphasised(
          { ...e.state, hovered: null, resting: null },
          teams,
        )}
        onPressedChange={() => e.toggleSelected(teams)}
        {...e.focusOn(teams)}
      >
        <Crosshair aria-hidden />
      </Toggle>
    </li>
  );
}
