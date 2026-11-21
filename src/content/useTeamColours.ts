import { useTheme } from "@picoframe/frame";
import { useMemo } from "react";
import type { DemoInfo, DemoTrailer } from "./bindings";
import { useStoredColorMode } from "./chartColorMode";
import { swatch } from "./pages/components/ReplayRoster";
import { teamColours } from "./replayMapLayers";

/**
 * Each engine team's colour, which is the colour of its line on the match chart
 * and follows the chart's In-game colours switch. The map's layers and the unit
 * map both draw a player in it. With no trailer there is no chart, and the
 * colours are the roster's swatches.
 */
export function useTeamColours(
  info: DemoInfo,
  trailer: DemoTrailer | null,
): ReadonlyMap<number, string> {
  const [colourMode] = useStoredColorMode();
  const { resolved: theme } = useTheme();
  return useMemo(
    () => teamColours(info, trailer, colourMode, theme, swatch),
    [info, trailer, colourMode, theme],
  );
}
