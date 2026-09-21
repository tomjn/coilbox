/**
 * Settings keys for where music comes from, in a file of their own so the hook
 * and the two components that use it do not have to import each other.
 */

/**
 * One of "off", "nostalgia" (the track coilbox bundles), "profile" (tracks the
 * distribution ships) or "game".
 */
export const MUSIC_SOURCE_KEY = "sound.music.source";

/** The game whose archive music is read from, when the source is a game. */
export const MUSIC_GAME_KEY = "sound.music.game";

/**
 * Where music comes from before a player chooses. A build that ships tracks
 * offers them, and one that does not has nothing to play, so it starts off
 * rather than pointing at a game nobody asked it to borrow from.
 */
export function defaultMusicSource(hasProfileTracks: boolean): string {
  return hasProfileTracks ? "profile" : "off";
}
