import type { ConfigOption } from "@/content/bindings";
import {
  THUMB_MINIMAP_MIP,
  useUnitsyncGameInfo,
  useUnitsyncMapInfo,
  useUnitsyncMinimap,
  useUnitsyncScan,
} from "@/content/config";
import type { SkirmishDraft } from "./drafts";
import type { PresetFitFacts } from "./presetFit";

/**
 * The options a finished read declared, or undefined while it is unread, failed
 * or could not be synced. An empty list is a real answer, a game or map that
 * declares none, and a failed read must not pass for it.
 */
function declaredOptions(read: {
  status: string;
  info: { options?: ConfigOption[] } | null;
}): ConfigOption[] | undefined {
  return read.status === "ready" ? read.info?.options : undefined;
}

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
  currentGameArchive,
  currentMapName,
  currentStartPosType,
  gameArchiveFor,
  checkMapInstalled,
}: {
  /** The preset being looked at, or null when the sheet is on its list. */
  preset: SkirmishDraft | null;
  enginePath?: string;
  dataDir?: string;
  currentGameName: string;
  /** The current game's primary archive, to read its declared options from. */
  currentGameArchive?: string;
  currentMapName: string;
  currentStartPosType: number;
  /** The archive to read a game's options from, for a preset naming another
   *  game. A surface that cannot change game does not need it. */
  gameArchiveFor?: (gameName: string) => string | undefined;
  /** Say whether the preset's map is installed, so the sheet can warn before a
   *  map the player lacks is sent. Singleplayer leaves it off, because loading
   *  there offers the download. */
  checkMapInstalled?: boolean;
}): PresetFitFacts | undefined {
  const currentGame = useUnitsyncGameInfo(
    enginePath,
    dataDir,
    currentGameArchive,
  );
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

  // Pointed at nothing unless asked, so a surface that does not warn about the
  // map never scans for it.
  const scan = useUnitsyncScan(
    checkMapInstalled ? enginePath : undefined,
    checkMapInstalled ? dataDir : undefined,
  );

  if (!preset) return undefined;
  return {
    currentGameName,
    currentMapName,
    currentStartPosType,
    modOptions: {
      current: declaredOptions(currentGame),
      preset: declaredOptions(presetGame),
    },
    mapOptions: {
      current: declaredOptions(currentMap),
      preset: declaredOptions(presetMap),
    },
    startPositions: {
      current: positionCount(currentPositions),
      preset: positionCount(presetPositions),
    },
    presetMapInstalled:
      checkMapInstalled && scan.data && presetMapName
        ? scan.data.maps.some((m) => m.name === presetMapName)
        : undefined,
  };
}
