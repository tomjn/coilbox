/**
 * Pure badge-visibility decision for the Conquest/Warpath "needs a game" nav
 * badge (issue #419), split out from `navBadges.tsx` so it's testable without
 * pulling in the picoframe frame / unitsync scan hooks: badge only once we
 * know for certain the mode isn't ready. While `loading` — resolving the
 * preferred engine, or engine resolved but the scan not back yet — this
 * returns `false` so the badge never flashes on and then off on first load.
 */
export function shouldShowNeedsGameBadge(
  ready: boolean,
  loading: boolean,
): boolean {
  return !loading && !ready;
}
