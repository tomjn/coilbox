import { useSetting } from "@picoframe/frame";
import { useMemo } from "react";
import { useUnitsyncArchiveTree } from "@/content/config";
import { useHostContent } from "@/multiplayer/battles/useHostContent";
import { usePreferredTarget } from "@/play/config";
import { getProfileSound } from "@/profile/profile";
import { findArchiveMusic, trackLabel } from "./archiveMusic";
import type { Track } from "./music";
import {
  defaultMusicSource,
  MUSIC_GAME_KEY,
  MUSIC_SOURCE_KEY,
} from "./musicSourceKeys";

/**
 * The music tracks in the game the player picked, and whether we are still
 * looking.
 *
 * Both the component that feeds the player and the one that reports what was
 * found read from here, rather than one of them reading module state the other
 * writes. Module state does not re-render anything, so the count on screen
 * would have stayed at whatever it was when the page mounted.
 *
 * The archive tree is cached by its own hook, so asking twice costs one read.
 */
export function useGameMusic(): {
  tracks: Track[];
  loading: boolean;
  /** The archive being read, when the player has chosen a game that resolves. */
  archive: string | undefined;
  target: ReturnType<typeof usePreferredTarget>["target"];
  enabled: boolean;
} {
  const [source] = useSetting<string>(
    MUSIC_SOURCE_KEY,
    defaultMusicSource(getProfileSound() !== null),
  );
  const [game] = useSetting<string>(MUSIC_GAME_KEY, "");
  const { target } = usePreferredTarget();
  const content = useHostContent();
  // unitsync opens an archive by its file name, not by the game's display name.
  // "SplinterFaction 0.1.86" is the game, "SplinterFaction_0.1.86.sdz" is the
  // archive, and asking for the former just fails to open anything.
  const archive = content.games.find((g) => g.name === game)?.primaryArchive
    .name;
  const enabled = source === "game" && game !== "" && archive !== undefined;
  const { tree, loading } = useUnitsyncArchiveTree(
    enabled ? target?.enginePath : undefined,
    enabled ? target?.dataDir : undefined,
    enabled ? archive : undefined,
  );

  const tracks = useMemo<Track[]>(() => {
    const files = tree?.files;
    if (!enabled || !files) return [];
    return findArchiveMusic(files).map((path) => ({
      kind: "archive",
      path,
      label: trackLabel(path),
    }));
  }, [enabled, tree]);

  return { tracks, loading, archive, target, enabled };
}
