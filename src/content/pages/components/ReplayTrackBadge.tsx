import { Badge } from "@/components/ui/badge";
import { useStoredTracks } from "../../replayTracks";

/**
 * Whether a replay has a recorded track (#3786): nothing when it has none, and
 * a quiet badge when it has. A stale track is amber and says it is not played.
 * The replay's page shows the full state in its analysis and recording section
 * (#3962), so this is for the list.
 *
 * A remix shares its original's game id and has no track of its own.
 */
export function ReplayTrackBadge({
  gameId,
  remixed = false,
}: {
  gameId: string | undefined;
  remixed?: boolean;
}) {
  const tracks = useStoredTracks();
  const track = gameId && !remixed ? tracks.get(gameId) : undefined;
  if (!track) return null;
  if (track.state === "stale") {
    return (
      <Badge
        variant="ghost"
        className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
        title="This track was made by another version of the recorder, or cannot be read. It is not played, and recording the replay again replaces it."
      >
        Track out of date
      </Badge>
    );
  }
  return (
    <Badge
      variant="ghost"
      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
      title="This replay has a recorded track."
    >
      Track recorded
    </Badge>
  );
}
