import { Button } from "@picoframe/frame";
import { Trophy, X } from "lucide-react";
import {
  debriefingHeadline,
  debriefingRank,
  debriefingRating,
  debriefingXp,
  forgetDebriefing,
  useDebriefing,
} from "./debriefing";

/**
 * What the Zero-K match that just ended did to the reader's rating (issue
 * #2003).
 *
 * The server pushes this when a match finishes and coilbox threw it away, so a
 * player who wanted to know whether their rating went up had to open the
 * website. It is the only post-match feedback any lobby protocol coilbox speaks
 * offers at all.
 *
 * In the battle room because that is where a Zero-K player is when it arrives:
 * the server keeps the room and its people together across the match, and puts
 * everybody who played into a chat channel for the room they are still sitting
 * in. Chobby shows the same thing in the same window.
 *
 * Dismissible, and drawn once. A result is news rather than a standing, and the
 * standing it produced is on every roster row from the moment the server
 * re-broadcasts the record.
 *
 * Two facts are deliberately not drawn. The awards, because upstream types that
 * field as a bare object with no shape to read. And the match's own web page,
 * because a link out of the app to a page about a game that has just ended is a
 * different decision from telling somebody their rating moved.
 */
export function DebriefingPanel() {
  const debriefing = useDebriefing();
  if (!debriefing) return null;
  // Every line the debriefing has to give, in the order somebody reads them:
  // what happened, what it did to the rating, where that leaves them, and the
  // experience, which is not skill and comes last for that reason.
  const lines = [
    debriefingRating(debriefing),
    debriefingRank(debriefing),
    debriefingXp(debriefing),
  ].filter((line): line is string => line !== null);
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-border bg-muted/40 px-4 py-2 text-sm"
    >
      <Trophy className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{debriefingHeadline(debriefing)}</p>
        {/* A custom game counts toward no rating and moves no rank, which
            leaves this with the result and nothing else. Said in words rather
            than left as a gap, because "did that count?" is the question a
            player has after a game they were not sure about. */}
        <p className="text-muted-foreground">
          {lines.length > 0
            ? lines.join(". ")
            : "This game counted toward no rating."}
        </p>
        {debriefing.message && (
          <p className="text-muted-foreground">{debriefing.message}</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        aria-label="Dismiss the match result"
        onClick={forgetDebriefing}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
