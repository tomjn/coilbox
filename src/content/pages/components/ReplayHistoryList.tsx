import { History } from "lucide-react";
import { Link } from "react-router";
import { useReplays } from "../../config";
import type { ReplayProvenance } from "../../replayUserState";
import { useReplayUserState } from "../../replayUserState";

/** Played date, short form for a compact history row. */
function playedAt(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * A node/run/mission's battle history — the replays whose recorded
 * {@link ReplayProvenance} matches `match`, newest first, each linking to its
 * detail page. Reads the content root's cheap replay listing itself (like
 * `ReplaysPage`), so a caller only needs the target's data dir and a
 * provenance predicate. Renders nothing (not even the section) when there's
 * no target yet or nothing matches — a caller wraps this with its own
 * "Battle history" heading only when it wants one always shown.
 */
export function ReplayHistoryList({
  dataDir,
  match,
  emptyLabel = "No replays recorded here yet.",
}: {
  dataDir?: string;
  match: (p: ReplayProvenance) => boolean;
  emptyLabel?: string;
}) {
  const { replays } = useReplays(dataDir);
  const userState = useReplayUserState();

  const matched = replays
    .filter((r) => {
      const p = userState.get(r.filename).provenance;
      return p ? match(p) : false;
    })
    .sort(
      (a, b) =>
        (b.startTimeMs || b.modifiedMs) - (a.startTimeMs || a.modifiedMs),
    );

  if (matched.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {matched.map((r) => (
        <li key={r.path}>
          <Link
            to={`/play/replays/${encodeURIComponent(r.filename)}`}
            className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs transition-colors hover:border-border hover:bg-accent/40"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <History className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{r.mapName ?? r.filename}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {playedAt(r.startTimeMs || r.modifiedMs)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
