import { useTheme } from "@picoframe/frame";
import { useMemo } from "react";
import type { DemoInfo, DemoTrailer } from "./bindings";
import { useStoredColorMode } from "./chartColorMode";
import {
  allySeries,
  autoColorMode,
  type ChartSeries,
  colorSeries,
  defaultChartView,
  seriesTeams,
  shownSeries,
  teamSeries,
} from "./matchStats";
import { useChartChoice, useSeriesEmphasis } from "./useSeriesEmphasis";

/**
 * The lines the replay page's statistics draw, as the chart draws them (#5308).
 * The chart and the dock's metric lane both call this, so the players or teams,
 * the colours and the lines the roster has unchecked are the same in both.
 *
 * `trailer` is null while it loads or when the profile hides statistics, which
 * gives no lines.
 */
export function useChartSeries(info: DemoInfo, trailer: DemoTrailer | null) {
  const { view: chosen } = useChartChoice();
  const [storedMode] = useStoredColorMode();
  const { resolved: theme } = useTheme();
  const { hidden } = useSeriesEmphasis().state;

  const players = useMemo(
    () => (trailer ? teamSeries(trailer, info) : []),
    [trailer, info],
  );
  const sides = useMemo(
    () => (trailer ? allySeries(trailer, info) : []),
    [trailer, info],
  );
  const view = chosen ?? defaultChartView(players, sides);
  // Until the toggle has been used the mode is the match's own pick, which also
  // follows the theme because contrast depends on the card.
  const colorMode = useMemo(
    () => storedMode ?? autoColorMode(players, sides, info, theme),
    [storedMode, players, sides, info, theme],
  );
  // Painted last, from the view's lines, so the colour a team wears depends on
  // the match and the mode and never on which lines are showing.
  const series = useMemo<ChartSeries[]>(
    () =>
      trailer
        ? colorSeries(
            view === "teams" ? sides : players,
            trailer,
            info,
            colorMode,
            theme,
          )
        : [],
    [view, sides, players, trailer, info, colorMode, theme],
  );
  // Every team the chart measures, whether its line is showing or not.
  const chartedTeams = useMemo(
    () => players.flatMap((s) => seriesTeams(s, info)).sort((a, b) => a - b),
    [players, info],
  );
  // The roster's unchecked teams come out here, after the painting above, so a
  // line keeps its colour whatever else is showing.
  const drawn = useMemo(
    () => shownSeries(series, info, chartedTeams, hidden),
    [series, info, chartedTeams, hidden],
  );
  return { players, sides, view, colorMode, series, chartedTeams, drawn };
}
