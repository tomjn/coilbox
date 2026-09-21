import type { ArchiveFileEntry } from "@/content/bindings";
import { AUDIO_EXTS } from "@/lib/assetUrl";

/**
 * Finding the music a game ships inside its own archive.
 *
 * There is no convention for where it lives, which a look through the installed
 * games settles rather than guesses at. Of seven, two ship any:
 *
 * - SplinterFaction keeps 28 tracks under `Music/original/<mood>/`, split into
 *   peace, warlow, warhigh, bossfight, loading and gameover.
 * - Spring 1944 keeps three under `LuaIntro/Assets/music/`, which is its
 *   loading screen's.
 *
 * The rest ship a `music.lua` and no audio, or nothing at all. So the rule here
 * is a path with a `music` directory segment in it, which covers both layouts
 * without either being hardcoded, and would pick up a third game that invents
 * its own.
 */

/**
 * Tracks are whole songs, so anything small is something else wearing the same
 * folder name: a UI blip, a jingle, a placeholder. 100 KB is comfortably below
 * the smallest real track found (Spring 1944's `lilimar4.ogg`, at 339 KB) and
 * comfortably above the sound effects that sit near these folders.
 */
const MIN_TRACK_BYTES = 100_000;

/**
 * unitsync returns audio as a data URL and refuses anything over 16 MB, so a
 * track bigger than that cannot be played this way at all. The largest found in
 * any installed game is 8.5 MB.
 */
const MAX_TRACK_BYTES = 16 * 1024 * 1024;

function hasMusicSegment(path: string): boolean {
  return path
    .toLowerCase()
    .split("/")
    .slice(0, -1)
    .some((segment) => segment === "music");
}

function isAudio(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTS.includes(ext);
}

/**
 * The playable music tracks in an archive's file list, in path order so a
 * game's own grouping survives.
 */
export function findArchiveMusic(files: ArchiveFileEntry[]): string[] {
  return files
    .filter(
      (f) =>
        isAudio(f.path) &&
        hasMusicSegment(f.path) &&
        f.size >= MIN_TRACK_BYTES &&
        f.size <= MAX_TRACK_BYTES,
    )
    .map((f) => f.path)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The mood a track sits under, for a game that groups them, or null when it
 * does not. SplinterFaction's `Music/original/bossfight/x.ogg` is "bossfight".
 *
 * Only used to label the track list. Coilbox plays lobby music and has no idea
 * whether a battle is going badly, so it cannot pick by mood and does not try.
 */
export function trackMood(path: string): string | null {
  const parts = path.split("/");
  const file = parts.length - 1;
  const parent = parts[file - 1];
  if (!parent || parent.toLowerCase() === "music") return null;
  return parent;
}

/** A track's file name without its folders or extension, for showing a player. */
export function trackLabel(path: string): string {
  const file = path.split("/").pop() ?? path;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}
