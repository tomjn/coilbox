/**
 * The widget handler an installed game runs, read from its archives through
 * unitsync and kept for the session.
 */

import {
  type GameItem,
  unitsyncArchiveFile,
  unitsyncArchiveTree,
} from "@/content/bindings";
import { recogniseHandler } from "./handlers";
import type { GameHandler } from "./widgetList";

/** Handlers already recognised this session, keyed by
 *  `dataDir::enginePath::` and every archive the game reads, because the
 *  handler can come from any of them. An archive's files do not change under a
 *  name. */
const handlerCache = new Map<string, GameHandler["handler"]>();

/** Archive file lists already read this session, keyed by
 *  `dataDir::enginePath::archive`, because most games share their dependency
 *  archives and each needs listing only once. */
const treeCache = new Map<string, readonly string[]>();

async function archiveFiles(
  enginePath: string,
  dataDir: string,
  archive: string,
): Promise<readonly string[]> {
  const key = `${dataDir}::${enginePath}::${archive}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  const tree = await unitsyncArchiveTree({ enginePath, dataDir, archive });
  const files = tree.files.map((f) => f.path);
  treeCache.set(key, files);
  return files;
}

export async function handlerOf(
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
    for (const f of await archiveFiles(enginePath, dataDir, archive.name)) {
      if (!owner.has(f)) owner.set(f, archive.name);
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
