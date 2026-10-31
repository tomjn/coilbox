import type { ConfigOption } from "@/content/bindings";
import {
  THUMB_MINIMAP_MIP,
  useUnitsyncGameInfo,
  useUnitsyncMapInfo,
  useUnitsyncMinimap,
} from "@/content/config";
import type { SkirmishDraft } from "./drafts";
import type { PresetFitFacts } from "./presetFit";

/** A start position count, or undefined while unread or when the map defines
 *  none, so neither case warns about a roster. */
function positionCount(
  read: ReturnType<typeof useUnitsyncMinimap>,
): number | undefined {
  return read.loading || read.startPositions.length === 0
    ? undefined
    : read.startPositions.length;
}

/**
 * Load what `presetFitWarnings` needs for the preset on screen.
 *
 * Reads both the current side and the preset's, always, so the hooks run with
 * the same arguments whichever parts are ticked. Which side counts is decided
 * from the ticks in `presetFitWarnings`. The reads share the session caches the
 * rest of the app fills, so a map or game already on screen costs nothing.
 */
export function usePresetFitFacts({
  preset,
  enginePath,
  dataDir,
  currentGameName,
  currentModOptions,
  currentMapName,
  currentStartPosType,
  gameArchiveFor,
}: {
  /** The preset being looked at, or null when the sheet is on its list. */
  preset: SkirmishDraft | null;
  enginePath?: string;
  dataDir?: string;
  currentGameName: string;
  /** The current game's declared options, which the caller already holds. */
  currentModOptions: ConfigOption[];
  currentMapName: string;
  currentStartPosType: number;
  /** The archive to read a game's options from, for a preset naming another
   *  game. A surface that cannot change game does not need it. */
  gameArchiveFor?: (gameName: string) => string | undefined;
}): PresetFitFacts | undefined {
  const otherGame =
    preset && preset.gameName !== currentGameName ? preset.gameName : undefined;
  const presetGame = useUnitsyncGameInfo(
    enginePath,
    dataDir,
    otherGame ? gameArchiveFor?.(otherGame) : undefined,
  );
  const presetMapName = preset?.mapName || undefined;
  const currentMap = useUnitsyncMapInfo(
    enginePath,
    dataDir,
    currentMapName || undefined,
  );
  const presetMap = useUnitsyncMapInfo(enginePath, dataDir, presetMapName);
  const currentPositions = useUnitsyncMinimap(
    enginePath,
    dataDir,
    currentMapName || undefined,
    THUMB_MINIMAP_MIP,
  );
  const presetPositions = useUnitsyncMinimap(
    enginePath,
    dataDir,
    presetMapName,
    THUMB_MINIMAP_MIP,
  );

  if (!preset) return undefined;
  return {
    currentGameName,
    currentMapName,
    currentStartPosType,
    modOptions: {
      current: currentModOptions,
      preset: presetGame.info?.options,
    },
    mapOptions: {
      current: currentMap.info?.options,
      preset: presetMap.info?.options,
    },
    startPositions: {
      current: positionCount(currentPositions),
      preset: positionCount(presetPositions),
    },
  };
}
