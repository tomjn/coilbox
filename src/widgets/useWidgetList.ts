/**
 * Everything the Widgets page reads (issue #1284): the engine's write folder,
 * the widget files in it, and the handler each installed game runs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 *  `dataDir::enginePath::` and every archive the game reads, because the
 *  handler can come from any of them. An archive's files do not change under a
 *  name. */
const handlerCache = new Map<string, GameHandler["handler"]>();

async function handlerOf(
  enginePath: string,
  dataDir: string,
  game: GameItem,
): Promise<GameHandler["handler"]> {
  // The game's own archive and the ones it depends on are one tree to the
  // engine, and a game built on another can take its handler from that one.
  const archives = [game.primaryArchive, ...game.dependencyArchives];
  const key = `${dataDir}::${enginePath}::${archives.map((a) => a.name).join("::")}`;
  const cached = handlerCache.get(key);
  if (cached !== undefined) return cached;
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
  const {
    data: scanData,
    error: scanError,
    run: runScan,
  } = useUnitsyncScan(enginePath, dataDir);
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
  // Only the latest read may land, so a slow read of a folder the page has
  // moved away from cannot replace the current one.
  const latest = useRef(0);
  const read = useCallback(async () => {
    const id = ++latest.current;
    if (!writeDir) return;
    setReading(true);
    try {
      const found = await contentPlayerWidgets({
        writeDir,
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
  }, [writeDir]);
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
        found.push({ game: game.name, handler });
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
    writeDir,
    /** Still finding out where the write folder is. */
    locating: !!selected && !engineConfig && configLoading,
    widgets,
    games,
    rows,
    reading,
    error: widgetsError ?? scanError,
    /** Folders that are there and could not be read. */
    folderErrors: widgets?.errors ?? [],
    reload: async () => {
      if (scanError) void runScan(true);
      await read();
    },
  };
}
