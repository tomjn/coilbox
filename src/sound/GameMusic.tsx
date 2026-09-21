import { useEffect } from "react";
import { unitsyncArchiveFile } from "@/content/bindings";
import { setArchiveResolver, setTracks } from "./music";
import { useGameMusic } from "./useGameMusic";

/**
 * Plays the music a game ships inside its own archive.
 *
 * Off unless a player asks for it, and deliberately so. A game's tracks are
 * written for its own runtime - SplinterFaction groups its by how the battle is
 * going - and coilbox is a lobby that has no idea how anything is going. Using
 * them as background music is a reasonable thing for a player to choose and a
 * rude thing for an app to decide.
 *
 * Tracks come back from unitsync whole rather than streamed, because they live
 * inside an archive only it can read. That caps a track at 16 MB, which every
 * one found in an installed game is comfortably under.
 */
export function GameMusic() {
  const { tracks, enabled, archive, target } = useGameMusic();
  // The two strings rather than the target object. `usePreferredTarget` builds
  // a fresh one every render, so depending on it would re-run this effect
  // constantly, and the effect is not free: it re-applies playback.
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  useEffect(() => {
    if (!enabled || !enginePath || !dataDir || !archive) {
      setArchiveResolver(null);
      return;
    }
    setArchiveResolver(async (path) => {
      const res = await unitsyncArchiveFile({
        enginePath,
        dataDir,
        archive,
        file: path,
      });
      if (res.kind !== "audio" || !res.dataUrl) return null;
      // A blob rather than the data URL itself. The element can seek in a blob,
      // and the base64 string is a third larger than the bytes it stands for.
      const blob = await (await fetch(res.dataUrl)).blob();
      return URL.createObjectURL(blob);
    });
    // The resolver goes in before the tracks, because setting the tracks is
    // what starts playback and a track with no way to fetch it just stalls.
    //
    // Set unconditionally, including to nothing. A game with no music has to
    // clear the list, or the previous game's tracks keep playing against a
    // resolver that now points somewhere else entirely.
    setTracks(tracks);
  }, [enabled, enginePath, dataDir, archive, tracks]);

  return null;
}
