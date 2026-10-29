/**
 * Everything the Widgets page reads (issue #1284): the engine's write folder,
 * the widget files in it, and the handler each installed game runs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  contentPlayerWidgets,
  type GameItem,
  type PlayerWidgetScan,
  unitsyncArchiveFile,
  unitsyncArchiveTree,
} from "@/content/bindings";
import {
  useScanTargetSelection,
  useUnitsyncEngineConfig,
  useUnitsyncScan,
} from "@/content/config";
import { engineConfigDir } from "@/content/enginePaths";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { errorText } from "@/lib/helpers";
import { HANDLER_FOLDERS, recogniseHandler } from "./handlers";
import { type GameHandler, widgetRows } from "./widgetList";

/** Handlers already recognised this session, keyed by
 *  `dataDir::enginePath::primary archive`. An archive's files do not change
 *  under a name. */
const handlerCache = new Map<string, GameHandler["handler"]>();

async function handlerOf(
  enginePath: string,
  dataDir: string,
  game: GameItem,
): Promise<GameHandler["handler"]> {
  const key = `${dataDir}::${enginePath}::${game.primaryArchive.name}`;
  const cached = handlerCache.get(key);
  if (cached !== undefined) return cached;
  // The game's own archive and the ones it depends on are one tree to the
  // engine, and a game built on another can take its handler from that one.
  const archives = [game.primaryArchive, ...game.dependencyArchives];
  const owner = new Map<string, string>();
  for (const archive of archives) {
    const tree = await unitsyncArchiveTree({
      enginePath,
      dataDir,
      archive: archive.name,
    });
    for (const f of tree.files) {
      if (!owner.has(f.path)) owner.set(f.path, archive.name);
    }
  }
  const handler = await recogniseHandler([...owner.keys()], async (file) => {
    const archive = owner.get(file);
    if (!archive) return null;
    const read = await unitsyncArchiveFile({
      enginePath,
      dataDir,
      archive,
      file,
    });
    return read.kind === "text" ? (read.text ?? null) : null;
  });
  handlerCache.set(key, handler);
  return handler;
}

export function useWidgetList() {
  const { targets, selected } = useScanTargetSelection();
  const enginePath = selected?.enginePath;
  const dataDir = selected?.rootPath;
  const { data: scanData, error: scanError } = useUnitsyncScan(
    enginePath,
    dataDir,
  );
  const { data: engineConfig, loading: configLoading } =
    useUnitsyncEngineConfig(enginePath, dataDir);
  const writeDir = engineConfigDir(engineConfig?.configPath);

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
  const read = useCallback(async () => {
    if (!writeDir) return;
    setReading(true);
    try {
      setWidgets(
        await contentPlayerWidgets({ writeDir, folders: HANDLER_FOLDERS }),
      );
      setWidgetsError(null);
    } catch (e) {
      setWidgetsError(errorText(e));
    } finally {
      setReading(false);
    }
  }, [writeDir]);
  useEffect(() => {
    void read();
  }, [read]);

  const [games, setGames] = useState<GameHandler[] | null>(null);
  useEffect(() => {
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
        found.push({ game: game.name, handler });
      }
      setGames(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, scanData, installed]);

  const rows = useMemo(
    () => (widgets && games ? widgetRows(widgets, games) : null),
    [widgets, games],
  );

  return {
    targets,
    writeDir,
    /** Still finding out where the write folder is. */
    locating: !!selected && !engineConfig && configLoading,
    widgets,
    games,
    rows,
    reading,
    error: widgetsError ?? scanError,
    reload: read,
  };
}
