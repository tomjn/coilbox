import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
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
            ariaLabel={t`Music source`}
            options={[
              { value: "off", label: t`No music` },
              { value: "nostalgia", label: t`Nostalgia` },
              // Only offered by a build that ships tracks, but always listed,
              // so it is clear the option exists and why it is unavailable.
              {
                value: "profile",
                label: t`Bundled`,
                description: hasProfileTracks
                  ? undefined
                  : t`This build ships no music.`,
                disabled: !hasProfileTracks,
              },
              { value: "game", label: t`From a game` },
            ]}
          />
        </div>
        <span className="space-y-1">
          <span className="block text-sm font-medium">
            <Trans>Music source</Trans>
          </span>
          <span className="block text-xs text-muted-foreground">
            <Trans>
              Games often ship their own soundtrack. Coilbox can play it in the
              lobby, though it was written to score a battle rather than a menu.
            </Trans>
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
              placeholder={t`Pick a game`}
              ariaLabel={t`Game to take music from`}
              gamesLoading={content.scanning}
              scanError={content.scanError}
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
  if (game === "") return <Trans>Pick a game to see what it ships.</Trans>;
  if (loading) return <Trans>Reading the archive…</Trans>;
  if (count === 0)
    return (
      <Trans>No music found in this game. Most ship sound effects only.</Trans>
    );
  return <Plural value={count} one="# track found." other="# tracks found." />;
}
