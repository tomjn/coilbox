import { Badge } from "@/components/ui/badge";

/**
 * Marks a game coilbox generated for itself rather than one the player
 * installed. Every picker hides these, so Content > Games is the one list that
 * shows them, and this badge is what stops a folder on disk that is missing
 * everywhere else from reading as a real game.
 *
 * `note` is the same sentence the game's own page carries, so hovering the badge
 * answers the question without leaving the grid.
 */
export function GeneratedBadge({ note }: { note: string }) {
  return (
    <Badge
      variant="ghost"
      className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide text-sky-700 dark:text-sky-400"
      title={note}
    >
      Coilbox&apos;s own
    </Badge>
  );
}
