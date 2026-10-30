/**
 * Everything the Widgets page reads (issue #1284): the widget files under
 * `LuaUI/` of every content root, the engine's write folder, and the handler
 * each installed game runs.
 *
 * The two folders are apart because an engine with a `springsettings.cfg`
 * beside its binary writes to its own folder (issue #4856). Every engine
 * coilbox starts reads every content root through `SPRING_DATADIR`, so a widget
 * in any of them loads (issue #4861). Widgets are added to the selected root,
 * and the games write their widget config to the write folder.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GameItem, type PlayerWidgetScan } from "@/content/bindings";
import {
  useScanTargetSelection,
  useUnitsyncEngineConfig,
  useUnitsyncScan,
} from "@/content/config";
import { useContentState } from "@/content/contentState";
import { engineConfigDir } from "@/content/enginePaths";
import { stripVersionSuffix } from "@/content/resolveContent";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { errorText } from "@/lib/helpers";
import { handlerOf } from "./gameHandler";
import {
  type GameHandler,
  type InstalledGame,
  oneEntryPerGame,
  widgetRows,
} from "./widgetList";
import { scanWidgetRoots, widgetRoots } from "./widgetRoots";

/** `info.name_pure` is the modinfo name before unitsync appends the version.
 *  A game that never set it, or left `$VERSION` unsubstituted in its name,
 *  falls back to its archive name with a trailing version dropped. */
function nameWithoutVersion(game: GameItem): string {
  const pure = game.info.name_pure?.trim();
  return pure && !pure.includes("$VERSION")
    ? pure
    : stripVersionSuffix(game.name);
}

export function useWidgetList() {
  const { targets, selected } = useScanTargetSelection();
  const enginePath = selected?.enginePath;
  const dataDir = selected?.rootPath;
  const {
    data: scanData,
    error: scanError,
    run: runScan,
  } = useUnitsyncScan(enginePath, dataDir);
  const { data: engineConfig } = useUnitsyncEngineConfig(enginePath, dataDir);
  const widgetDir = dataDir;
  const { state: contentState } = useContentState();
  // A key rather than the array, so a new state with the same roots does not
  // read the folders again.
  const rootsKey = JSON.stringify(
    widgetDir ? widgetRoots(contentState, widgetDir) : [],
  );
  const roots = useMemo<string[]>(() => JSON.parse(rootsKey), [rootsKey]);
  const configDir = engineConfigDir(engineConfig?.configPath);

  const installed = useMemo(
    () =>
      withoutGeneratedGames(scanData?.games ?? []).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [scanData],
  );

  const [widgets, setWidgets] = useState<PlayerWidgetScan | null>(null);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // Only the latest read may land, so a slow read of a folder the page has
  // moved away from cannot replace the current one.
  const latest = useRef(0);
  const read = useCallback(async () => {
    const id = ++latest.current;
    if (roots.length === 0) return;
    setReading(true);
    try {
      const found = await scanWidgetRoots(roots);
      if (id !== latest.current) return;
      setWidgets(found);
      setWidgetsError(null);
    } catch (e) {
      if (id === latest.current) setWidgetsError(errorText(e));
    } finally {
      if (id === latest.current) setReading(false);
    }
  }, [roots]);
  useEffect(() => {
    setWidgets(null);
    void read();
  }, [read]);

  const [games, setGames] = useState<GameHandler[] | null>(null);
  useEffect(() => {
    // With no game list there is nothing to say which games load a file, but
    // the files are still worth listing.
    if (scanError && !scanData) {
      setGames([]);
      return;
    }
    if (!enginePath || !dataDir || !scanData) return;
    let cancelled = false;
    setGames(null);
    (async () => {
      const found: InstalledGame[] = [];
      // One at a time, because every read goes through the one unitsync worker.
      for (const game of installed) {
        let handler: GameHandler["handler"] = null;
        try {
          handler = await handlerOf(enginePath, dataDir, game);
        } catch (e) {
          console.warn(`could not read ${game.name}'s widget handler`, e);
        }
        if (cancelled) return;
        found.push({
          game: game.name,
          shortName: game.info.shortname?.trim() || undefined,
          handler,
          version: game.info.version ?? "",
          title: nameWithoutVersion(game),
        });
      }
      setGames(oneEntryPerGame(found));
    })();
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, scanData, scanError, installed]);

  const rows = useMemo(
    () => (widgets && games ? widgetRows(widgets, games) : null),
    [widgets, games],
  );

  return {
    targets,
    enginePath,
    /** The installed games, a version each, which the game widgets are read
     *  from. */
    installed,
    /** The selected content root, where a widget is added. */
    widgetDir,
    /** Every content root the engine reads, the selected one first. */
    roots,
    /** The engine's write folder, where the games keep their widget config. */
    configDir,
    widgets,
    games,
    rows,
    reading,
    error: widgetsError ?? scanError,
    /** Folders that are there and could not be read. */
    folderErrors: widgets?.errors ?? [],
    /** The game list was read, so the rows can say which games load them. */
    gamesKnown: !!scanData,
    reload: async () => {
      if (scanError) void runScan(true);
      await read();
    },
  };
}
