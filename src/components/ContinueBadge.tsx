import { cn } from "@/lib/utils";

/**
 * Class string for the small "Continue" pill used across every per-screen
 * resume affordance (issue #374). Mirrors the "Last used" badge on the
 * multiplayer login panel (`LoginPanel` in `multiplayer/LobbyStatusButton.tsx`)
 * so the app's various "jump back in" cues share one visual language. Exported
 * as a class string (not just the component below) so a caller that needs the
 * badge to itself be the clickable resume target (e.g. a `Link`) can apply it
 * directly, rather than being forced through an inert `<span>`.
 */
export const CONTINUE_BADGE_CLASS =
  "shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary";

/** The inert form: a badge sitting inside a row that's already clickable
 * (e.g. a card whose own link already opens the right thing to resume). */
export function ContinueBadge({
  label = "Continue",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return <span className={cn(CONTINUE_BADGE_CLASS, className)}>{label}</span>;
}
