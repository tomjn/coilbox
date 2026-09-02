import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** The full text behind the stale-scenario badge, said once for a screen
 * reader and again as the badge's hover title. */
export const STALE_SCENARIO_WARNING =
  "The scenario has been edited since this copy was attached.";

/**
 * A mission is playing a copy the stored scenario has moved on from.
 *
 * A badge rather than a sentence, so a stale attachment is a shape to notice in
 * one scan pass rather than a paragraph to read. The full warning stays in the
 * DOM for a screen reader and on hover.
 *
 * One component for both places it appears, because they are the same claim:
 * the mission row on the campaign page, and the mission editor's Scenario
 * heading while that group is shut (issue #2392). Two copies of the wording
 * would drift, and the heading is opened from the row.
 */
export function StaleScenarioBadge() {
  return (
    <Badge
      variant="outline"
      title={STALE_SCENARIO_WARNING}
      className="gap-1 border-amber-600/40 text-amber-600 dark:border-amber-500/40 dark:text-amber-500"
    >
      <TriangleAlert className="size-3" aria-hidden="true" />
      Out of date
      <span className="sr-only"> {STALE_SCENARIO_WARNING}</span>
    </Badge>
  );
}
