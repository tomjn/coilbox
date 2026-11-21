import { useMemo } from "react";
import { isProfileHidden } from "../profile/hidden";
import type { DemoInfo, ReplayTrackTeam } from "./bindings";
import {
  emphasisedStyles,
  type TeamStyle,
  teamStyles,
} from "./replayMapView/paint";
import { activeTeams } from "./seriesEmphasis";
import { useMatchStats } from "./useMatchStats";
import { useSeriesEmphasis } from "./useSeriesEmphasis";
import { useTeamColours } from "./useTeamColours";

/**
 * How the unit map draws each engine team: in the colour of the team's line on
 * the chart, faint when the players table has it unticked or points at another
 * team, and lit when the table points at it. Anything else on the map that
 * stands for a player reads this, so a unit's icon and its mark agree.
 *
 * Mount it under a `SeriesEmphasisProvider`.
 */
export function useUnitMapStyles(
  info: DemoInfo,
  replayPath: string | undefined,
  teams: readonly ReplayTrackTeam[],
): ReadonlyMap<number, TeamStyle> {
  const stats = useMatchStats(
    !isProfileHidden("analytics.matchStats") && replayPath ? replayPath : null,
  );
  const colours = useTeamColours(info, stats.data?.trailer ?? null);
  const { state } = useSeriesEmphasis();
  const base = useMemo(() => teamStyles(teams, colours), [teams, colours]);
  return useMemo(
    () =>
      emphasisedStyles(base, {
        hidden: state.hidden,
        active: activeTeams(state),
      }),
    [base, state],
  );
}
