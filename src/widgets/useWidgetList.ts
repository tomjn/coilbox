/**
 * Everything the Widgets page reads (issue #1284): the widget files under the
 * content root's `LuaUI/`, the engine's write folder, and the handler each
 * installed game runs.
 *
 * The two folders are apart because an engine with a `springsettings.cfg`
 * beside its binary writes to its own folder (issue #4856). Every engine
 * coilbox starts reads the content root through `SPRING_DATADIR`, so widgets go
 * there, and the games write their widget config to the write folder.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  contentPlayerWidgets,
  type PlayerWidgetScan,
} from "@/content/bindings";
import {
  useScanTargetSelection,
  useUnitsyncEngineConfig,
  useUnitsyncScan,
} from "@/content/config";
import { engineConfigDir } from "@/content/enginePaths";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { errorText } from "@/lib/helpers";
import { handlerOf } from "./gameHandler";
import { HANDLER_FOLDERS } from "./handlers";
import { type GameHandler, widgetRows } from "./widgetList";

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
    if (!widgetDir) return;
    setReading(true);
    try {
      const found = await contentPlayerWidgets({
        writeDir: widgetDir,
        folders: HANDLER_FOLDERS,
      });
      if (id !== latest.current) return;
      setWidgets(found);
      setWidgetsError(null);
    } catch (e) {
      if (id === latest.current) setWidgetsError(errorText(e));
    } finally {
      if (id === latest.current) setReading(false);
    }
  }, [widgetDir]);
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
      const found: GameHandler[] = [];
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
        });
      }
      setGames(found);
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
    /** The content root, which the widget folders are under. */
    widgetDir,
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
