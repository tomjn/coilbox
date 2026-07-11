import { useSetting } from "@picoframe/frame";

/**
 * The single "my team colour" remembered across battles, surfaces and restarts,
 * as `#rrggbb` (empty = never picked). Kept in its own file so `teamColor.ts`
 * stays hook-free. Reuses the historical `multiplayer.teamColor` setting key —
 * the `multiplayer.` prefix is now just a legacy name shared by all surfaces
 * (lobby + singleplayer), so there's zero migration.
 */
export const useMyTeamColor = () =>
  useSetting<string>("multiplayer.teamColor", "");
