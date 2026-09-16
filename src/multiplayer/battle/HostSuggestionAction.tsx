import { Button } from "@picoframe/frame";
import { Check, X } from "lucide-react";
import {
  type HostSuggestion,
  hostSuggestionActionLabel,
  hostSuggestionText,
} from "./hostSuggestion";

/**
 * The line under a `!balance`/`!lock`/`!unlock` chat message, founder-only
 * (issue #2871, the same shape as `MapSuggestionAction`'s Accept on a `!map`
 * line). Unlike a map name, there is nothing here to get wrong or leave
 * ambiguous, so both an Accept and a Reject are always on offer.
 *
 * This is drawn under the message, not instead of it: the bubble above still
 * shows the plain `!balance`/`!lock` text a real autohost reads, so
 * selecting or copying that line, alone or as part of a drag across several
 * lines of chat, still yields the literal command. The sentence here is a
 * caption for the buttons, read alongside the command rather than replacing
 * it.
 */
export function HostSuggestionAction({
  suggestion,
  onAccept,
  onReject,
}: {
  suggestion: HostSuggestion;
  onAccept: () => void;
  onReject: () => void;
}) {
  const label = hostSuggestionActionLabel(suggestion.kind);
  return (
    <div className="flex flex-col gap-1 px-1">
      <p className="text-xs text-muted-foreground">
        {hostSuggestionText(suggestion.kind)}
      </p>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-2 text-xs"
          onClick={onAccept}
        >
          <Check className="size-3" />
          {`Accept: ${label}`}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-2 text-xs"
          onClick={onReject}
        >
          <X className="size-3" />
          Reject
        </Button>
      </div>
    </div>
  );
}
