/**
 * Sidebar nav-item badge for Conquest and Warpath (issue #419).
 *
 * #402 decided Conquest/Warpath stay in the nav (unlike Campaigns, which hides
 * itself via `useHasCampaigns` until content exists) because they're core game
 * modes, not dead ends — their empty states already link to install an engine
 * or a game. #419 asks for a lighter-weight signal than hiding: a subtle
 * "needs a game" marker so a day-one user can see at a glance the mode isn't
 * ready yet, without losing the ability to click through to those install
 * links.
 *
 * The frame calls a nav item's `badge()` inside the sidebar item's render, but
 * only when the sidebar is expanded — a *conditional* call. So `badge` returns
 * this component (an element), never calls hooks itself: the hooks live in a
 * child fiber that mounts/unmounts cleanly as the sidebar collapses, matching
 * the pattern in `multiplayer/nav/navBadges.tsx`.
 */
import { Badge } from "@/components/ui/badge";
import { usePlayReadiness } from "./config";
import { shouldShowNeedsGameBadge } from "./navBadgeLogic";

/**
 * Renders nothing once ready (engine + game installed) or while the initial
 * scan is still resolving. Reads the exact same readiness check
 * `ConquestListPage` and `RunListPage` use for their empty states, so the
 * badge and the in-page guidance always agree.
 */
export function NeedsGameNavBadge() {
  const { ready, loading } = usePlayReadiness();
  if (!shouldShowNeedsGameBadge(ready, loading)) return null;
  return (
    <Badge
      variant="outline"
      className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
    >
      Needs a game
    </Badge>
  );
}
