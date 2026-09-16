import { Button } from "@picoframe/frame";
import { Check } from "lucide-react";
import type { MapSuggestion } from "./mapSuggestion";

/**
 * The line under a `!map <name>` chat message, host-only (issue #2795). One
 * installed match gets an Accept button. More than one lists the names
 * instead of guessing which the player meant. None says so, with no button.
 */
export function MapSuggestionAction({
  suggestion,
  pending,
  onAccept,
}: {
  suggestion: MapSuggestion;
  /** A map change is already in flight (waiting on its checksum). */
  pending: boolean;
  onAccept: (name: string) => void;
}) {
  if (suggestion.matches.length === 0) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        No installed map matches “{suggestion.query}”.
      </p>
    );
  }
  if (suggestion.matches.length > 1) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        Matches: {suggestion.matches.join(", ")}
      </p>
    );
  }
  const [name] = suggestion.matches;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-6 gap-1 px-2 text-xs"
      disabled={pending}
      onClick={() => onAccept(name)}
    >
      <Check className="size-3" />
      {pending ? "Changing map…" : `Accept: ${name}`}
    </Button>
  );
}
