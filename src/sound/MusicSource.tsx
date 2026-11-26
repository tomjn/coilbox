import { t as coreT, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useSetting } from "@picoframe/frame";
import { OptionSelect } from "@/components/OptionSelect";
import { SettingRow } from "@/components/SettingRow";
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
 * inside a game's own archive. Rows for a `<SettingList>`.
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
    <>
      <SettingRow
        id="sound-music-source"
        label={t`Music source`}
        helpLabel={t`About the music source`}
        help={
          <p>
            <Trans>
              Games often ship their own soundtrack. Coilbox can play it in the
              lobby, though it was written to score a battle rather than a menu.
            </Trans>
          </p>
        }
      >
        <div className="w-40">
          <OptionSelect
            id="sound-music-source"
            value={source}
            onValueChange={setSource}
            size="sm"
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
      </SettingRow>

      {source === "game" && (
        <SettingRow
          label={t`Game`}
          description={trackCount(game, loading, tracks.length)}
        >
          <div className="w-64">
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
        </SettingRow>
      )}
    </>
  );
}

/**
 * Reading an archive takes a while the first time, so "still looking" has to
 * say so. Showing "no music found" while the answer is not in yet reads as a
 * verdict, and the player goes off believing their game ships none.
 */
function trackCount(game: string, loading: boolean, count: number): string {
  if (game === "") return coreT`Pick a game to see what it ships.`;
  if (loading) return coreT`Reading the archive…`;
  if (count === 0)
    return coreT`No music found in this game. Most ship sound effects only.`;
  return plural(count, { one: "# track found.", other: "# tracks found." });
}
