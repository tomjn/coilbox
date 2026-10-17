import { Button } from "@picoframe/frame";

import type { JoinSummary } from "../../connectors";

/** The piece panel's "Joined to" line, with the Detach action for a join. */
export function JoinedTo({
  join,
  onDetach,
}: {
  join: JoinSummary | null;
  onDetach: () => void;
}) {
  return (
    <div className="mt-2">
      <span className="text-xs text-muted-foreground">Joined to</span>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {join ? (
          <>
            <span
              className={`min-w-0 flex-1 truncate ${
                join.broken ? "text-destructive" : ""
              }`}
              title={
                join.broken
                  ? "A face this join names is missing from a part, so the piece stays where it was"
                  : undefined
              }
            >
              {join.broken ? "Broken: " : ""}
              {join.parentName} ({join.to}) by its {join.connector}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={onDetach}
            >
              Detach
            </Button>
          </>
        ) : (
          <span>Free</span>
        )}
      </div>
    </div>
  );
}
