/**
 * The widget handler an installed game runs, and the widgets the game ships,
 * read from its archives through unitsync and kept for the session.
 */

import {
  type GameItem,
  unitsyncArchiveFile,
  unitsyncArchiveTree,
  unitsyncArchiveWidgets,
} from "@/content/bindings";
import { type GameWidget, readWidgets, widgetMembers } from "./gameWidgets";
import { recogniseHandler, type WidgetHandler } from "./handlers";
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

/** The key a game's archives are cached under. The game's own archive and
 *  the ones it depends on are one tree to the engine, and a game built on
 *  another can take its handler and widgets from that one. */
function gameKey(enginePath: string, dataDir: string, game: GameItem): string {
  const archives = [game.primaryArchive, ...game.dependencyArchives];
  return `${dataDir}::${enginePath}::${archives.map((a) => a.name).join("::")}`;
}

/** The archive each of the game's files is read from: the first to have it. */
async function fileOwners(
  enginePath: string,
  dataDir: string,
  game: GameItem,
): Promise<Map<string, string>> {
  const owner = new Map<string, string>();
  for (const archive of [game.primaryArchive, ...game.dependencyArchives]) {
    for (const f of await archiveFiles(enginePath, dataDir, archive.name)) {
      if (!owner.has(f)) owner.set(f, archive.name);
    }
  }
  return owner;
}

export async function handlerOf(
  enginePath: string,
  dataDir: string,
  game: GameItem,
): Promise<GameHandler["handler"]> {
  const key = gameKey(enginePath, dataDir, game);
  const cached = handlerCache.get(key);
  if (cached !== undefined) return cached;
  const owner = await fileOwners(enginePath, dataDir, game);
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

/** Game widgets already read this session, keyed like {@link handlerCache}
 *  and the handler that loads them. */
const widgetCache = new Map<
  string,
  Promise<{ widgets: GameWidget[]; errors: string[] }>
>();

/**
 * The widgets `game` ships that `handler` loads, each with what its
 * `GetInfo()` declares (issue #4857), and why an archive could not be read.
 */
export function gameWidgetsOf(
  enginePath: string,
  dataDir: string,
  game: GameItem,
  handler: WidgetHandler,
): Promise<{ widgets: GameWidget[]; errors: string[] }> {
  const key = `${gameKey(enginePath, dataDir, game)}::${handler.id}`;
  const cached = widgetCache.get(key);
  if (cached) return cached;
  const read = (async () => {
    const owner = await fileOwners(enginePath, dataDir, game);
    const widgets: GameWidget[] = [];
    const errors: string[] = [];
    for (const [archive, members] of widgetMembers(owner, handler)) {
      const out = await unitsyncArchiveWidgets({
        enginePath,
        dataDir,
        archive,
        files: members.map((m) => m.path),
      });
      widgets.push(...readWidgets(members, archive, out.files));
      // unitsync reports warnings beside a read that worked. Only a read that
      // found nothing has its errors to show.
      if (out.files.length === 0) errors.push(...out.errors);
    }
    return { widgets, errors };
  })();
  widgetCache.set(key, read);
  // A read that failed is tried again next time rather than kept.
  read.catch(() => widgetCache.delete(key));
  return read;
}
