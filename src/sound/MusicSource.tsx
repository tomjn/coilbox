import { useSetting } from "@picoframe/frame";
import { OptionSelect } from "@/components/OptionSelect";
import { useUnitsyncGameHeaders } from "@/content/config";
import { useHostContent } from "@/multiplayer/battles/useHostContent";
import { GamePickerField } from "@/play/pages/components/GamePickerButton";
import { getProfileSound } from "@/profile/profile";
import {
  defaultMusicSource,
  MUSIC_GAME_KEY,
  MUSIC_SOURCE_KEY,
} from "./musicSourceKeys";
import { useGameMusic } from "./useGameMusic";

/**
 * Where the soundtrack comes from: the tracks this build ships, or the music
 * inside a game's own archive.
 *
 * The game option is never the default. A game's music is written for its own
 * runtime, and borrowing it for a lobby is a player's call to make.
 */
export function MusicSource() {
  const hasProfileTracks = getProfileSound() !== null;
  const [source, setSource] = useSetting<string>(
    MUSIC_SOURCE_KEY,
    defaultMusicSource(hasProfileTracks),
  );
  const [game, setGame] = useSetting<string>(MUSIC_GAME_KEY, "");
  const content = useHostContent();
  const { headers: gameHeaders } = useUnitsyncGameHeaders(
    content.target?.enginePath,
    content.target?.dataDir,
  );
  const { tracks, loading } = useGameMusic();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-40 shrink-0">
          <OptionSelect
            value={source}
            onValueChange={setSource}
            size="sm"
            ariaLabel="Music source"
            options={[
              { value: "off", label: "No music" },
              { value: "nostalgia", label: "Nostalgia" },
              // Only offered by a build that ships tracks, but always listed,
              // so it is clear the option exists and why it is unavailable.
              {
                value: "profile",
                label: "Bundled",
                description: hasProfileTracks
                  ? undefined
                  : "This build ships no music.",
                disabled: !hasProfileTracks,
              },
              { value: "game", label: "From a game" },
            ]}
          />
        </div>
        <span className="space-y-1">
          <span className="block text-sm font-medium">Music source</span>
          <span className="block text-xs text-muted-foreground">
            Games often ship their own soundtrack. Coilbox can play it in the
            lobby, though it was written to score a battle rather than a menu.
          </span>
        </span>
      </div>

      {source === "game" && (
        <div className="flex items-start gap-3">
          <div className="w-64 shrink-0">
            <GamePickerField
              value={game}
              onValueChange={setGame}
              games={content.games}
              headers={gameHeaders}
              placeholder="Pick a game"
              ariaLabel="Game to take music from"
              gamesLoading={content.scanning}
            />
          </div>
          <span className="block text-xs text-muted-foreground">
            <TrackCount game={game} loading={loading} count={tracks.length} />
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Reading an archive takes a while the first time, so "still looking" has to
 * say so. Showing "no music found" while the answer is not in yet reads as a
 * verdict, and the player goes off believing their game ships none.
 */
function TrackCount({
  game,
  loading,
  count,
}: {
  game: string;
  loading: boolean;
  count: number;
}) {
  if (game === "") return <>Pick a game to see what it ships.</>;
  if (loading) return <>Reading the archive…</>;
  if (count === 0)
    return <>No music found in this game. Most ship sound effects only.</>;
  return (
    <>
      {count} track{count === 1 ? "" : "s"} found.
    </>
  );
}
