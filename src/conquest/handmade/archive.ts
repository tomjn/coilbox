import {
  type GameItem,
  unitsyncArchiveFile,
  unitsyncArchiveTree,
} from "../../content/bindings";
import { currentScan } from "../../content/config";
import { withoutGeneratedGames } from "../../lib/generatedGames";
import { compareGameVersions } from "../../play/installedGames";
import type { HandmadeMapError } from "./errors";
import { MANIFEST_FILE } from "./manifest";

/**
 * Hand-made maps a game archive carries (issue #3511). A game maker puts each
 * map folder under {@link ARCHIVE_MAPS_DIR} in the game archive, and coilbox
 * reads it through unitsync, so a loose `.sdd` and a packed `.sdz` or `.sd7`
 * read the same way.
 *
 * The engine reads its own fixed folders (`LuaRules/`, `gamedata/`, `units/`,
 * `maps/` and the rest) and nothing under `coilbox/`, so a folder there can
 * never be taken for game content. `maps/` alone would not do: it is where the
 * engine looks for `.smf` maps.
 *
 * Every read opens the archive afresh, so it sees the files as they are on
 * disk now. A refresh, or a rescan of the game's content, starts a new reader.
 */

/** Where map folders live inside a game archive. */
export const ARCHIVE_MAPS_DIR = "coilbox/maps";

/** The optional file beside the map folders with the game's settings. */
export const ARCHIVE_INDEX_FILE = "index.json";

/** The engine and content root the archives are read with. */
export interface ArchiveTarget {
  enginePath: string;
  dataDir: string;
}

/** A game whose archive is searched for maps. */
export interface ArchiveGame {
  /** The game's name as unitsync reports it, version included. */
  name: string;
  /** The archive file name unitsync opens, such as `S44_2.1.sdz`. */
  archive: string;
  shortname: string;
}

/** One map folder a game archive carries. */
export interface ArchiveMapItem {
  game: ArchiveGame;
  folder: string;
  /** Paths inside the folder, as `urlFor` is asked for them. */
  files: string[];
  /** The text of `map.json`. */
  manifest: string;
}

export interface ArchiveListing {
  items: ArchiveMapItem[];
  unreadable: {
    game: ArchiveGame;
    folder: string;
    errors: HandmadeMapError[];
  }[];
  /** The games whose `index.json` asks for their own maps only, by name. */
  onlyOwnMaps: string[];
}

/** A file read out of an archive: a URL the webview can load, or why not. */
export type ArchiveRead =
  | { ok: true; url: string; text?: string }
  | { ok: false; error: HandmadeMapError };

/**
 * The installed games to search, newest version first. A map id two versions
 * carry is then taken from the newer one.
 */
export function archiveGames(games: readonly GameItem[]): ArchiveGame[] {
  return withoutGeneratedGames(games)
    .slice()
    .sort((a, b) =>
      compareGameVersions(b.info.version ?? "", a.info.version ?? ""),
    )
    .map((g) => ({
      name: g.name,
      archive: g.primaryArchive.name,
      shortname: (g.info.shortname ?? g.name).trim(),
    }));
}

/**
 * Read the game's settings from `index.json`. Only `onlyOwnMaps` is read, and
 * other keys are left alone for later settings.
 */
export function parseArchiveIndex(text: string): {
  onlyOwnMaps: boolean;
  errors: HandmadeMapError[];
} {
  const where = `${ARCHIVE_MAPS_DIR}/${ARCHIVE_INDEX_FILE}`;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      onlyOwnMaps: false,
      errors: [
        {
          code: "manifest-json",
          message: `${where} is not valid JSON, so its settings are not used.`,
        },
      ],
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      onlyOwnMaps: false,
      errors: [
        {
          code: "manifest-json",
          message: `${where} must hold an object such as { "onlyOwnMaps": true }.`,
        },
      ],
    };
  }
  const flag = (value as Record<string, unknown>).onlyOwnMaps;
  if (flag === undefined || typeof flag === "boolean") {
    return { onlyOwnMaps: flag === true, errors: [] };
  }
  return {
    onlyOwnMaps: false,
    errors: [
      {
        code: "manifest-field",
        path: "onlyOwnMaps",
        message: `${where}: onlyOwnMaps must be true or false.`,
      },
    ],
  };
}

/** The text of a member as a URL, so it reads like any other map file. */
function textUrl(text: string): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
}

/** Why a member that is in the archive could not be read, for the author. */
function unreadable(file: string, why: string): ArchiveRead {
  return {
    ok: false,
    error: {
      code: "archive-unreadable",
      file,
      message: `"${file}" is in the game archive, but ${why}`,
    },
  };
}

export interface ArchiveReader {
  list(): Promise<ArchiveListing>;
  /** Read `file` from the map folder `folder` of `game`. */
  read(game: ArchiveGame, folder: string, file: string): Promise<ArchiveRead>;
}

/**
 * A reader over the archives of every installed game. It lists once and reads
 * each file once, so listing and then opening a map does not read it twice.
 * Make a new one to read the archives again.
 */
export function createArchiveReader(target: ArchiveTarget): ArchiveReader {
  let listing: Promise<ArchiveListing> | undefined;
  const reads = new Map<string, Promise<ArchiveRead>>();
  /** The real path of each member, by archive and the path in lower case. */
  const paths = new Map<string, Map<string, string>>();

  const fetchMember = async (game: ArchiveGame, path: string) =>
    unitsyncArchiveFile({ ...target, archive: game.archive, file: path });

  const readMember = async (
    game: ArchiveGame,
    file: string,
    path: string,
  ): Promise<ArchiveRead> => {
    let res: Awaited<ReturnType<typeof fetchMember>>;
    try {
      res = await fetchMember(game, path);
    } catch (e) {
      return unreadable(
        file,
        `it could not be read. ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (res.kind === "text" && res.text !== undefined) {
      return { ok: true, url: textUrl(res.text), text: res.text };
    }
    if (res.kind === "image" && res.dataUrl) {
      return { ok: true, url: res.dataUrl };
    }
    if (res.truncated) {
      return unreadable(
        file,
        "it is too large to read from a game archive. Text files can be up to 512 KB and images up to 8 MB.",
      );
    }
    if (/\.(gltf|glb|bin)$/i.test(file)) {
      return unreadable(
        file,
        "coilbox cannot read model files from a game archive yet. Leave models out of a map the game carries.",
      );
    }
    if (res.errors.length > 0) {
      return unreadable(file, `it could not be read. ${res.errors.join(" ")}`);
    }
    return unreadable(
      file,
      "coilbox cannot read this kind of file from a game archive. Use PNG or JPEG for images and JSON for text.",
    );
  };

  const listGame = async (game: ArchiveGame, into: ArchiveListing) => {
    let tree: Awaited<ReturnType<typeof unitsyncArchiveTree>>;
    try {
      tree = await unitsyncArchiveTree({ ...target, archive: game.archive });
    } catch {
      // A game whose archive will not open carries nothing coilbox can read.
      return;
    }
    const prefix = `${ARCHIVE_MAPS_DIR}/`;
    const byLower = new Map<string, string>();
    const folders = new Map<string, string[]>();
    let index: string | undefined;
    for (const { path } of tree.files) {
      if (path.endsWith("/")) continue;
      if (!path.toLowerCase().startsWith(prefix)) continue;
      byLower.set(path.toLowerCase(), path);
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) {
        if (rest.toLowerCase() === ARCHIVE_INDEX_FILE) index = path;
        continue;
      }
      const folder = rest.slice(0, slash);
      const list = folders.get(folder) ?? [];
      list.push(rest.slice(slash + 1));
      folders.set(folder, list);
    }
    paths.set(game.archive, byLower);

    if (index !== undefined) {
      const read = await member(game, ARCHIVE_INDEX_FILE, index);
      const text = read.ok ? read.text : undefined;
      const parsed =
        text === undefined
          ? {
              onlyOwnMaps: false,
              errors: [read.ok ? unreadableIndex() : read.error],
            }
          : parseArchiveIndex(text);
      if (parsed.onlyOwnMaps) into.onlyOwnMaps.push(game.name);
      if (parsed.errors.length > 0) {
        into.unreadable.push({
          game,
          folder: ARCHIVE_INDEX_FILE,
          errors: parsed.errors,
        });
      }
    }

    for (const [folder, files] of folders) {
      if (!files.includes(MANIFEST_FILE)) continue;
      const read = await member(
        game,
        MANIFEST_FILE,
        `${prefix}${folder}/${MANIFEST_FILE}`,
      );
      const manifest = read.ok ? read.text : undefined;
      if (manifest === undefined) {
        into.unreadable.push({
          game,
          folder,
          errors: [read.ok ? unreadableIndex() : read.error],
        });
        continue;
      }
      into.items.push({ game, folder, files: files.sort(), manifest });
    }
  };

  const member = (
    game: ArchiveGame,
    file: string,
    path: string,
  ): Promise<ArchiveRead> => {
    const key = `${game.archive}\0${path.toLowerCase()}`;
    let read = reads.get(key);
    if (!read) {
      read = readMember(game, file, path);
      reads.set(key, read);
    }
    return read;
  };

  return {
    list() {
      listing ??= (async () => {
        const out: ArchiveListing = {
          items: [],
          unreadable: [],
          onlyOwnMaps: [],
        };
        const scan = await currentScan(target.enginePath, target.dataDir);
        // One game at a time: each read starts unitsync, and several at once
        // would all scan the same content root together.
        for (const game of archiveGames(scan.games)) await listGame(game, out);
        return out;
      })();
      return listing;
    },
    async read(game, folder, file) {
      const wanted = `${ARCHIVE_MAPS_DIR}/${folder}/${file}`;
      const path = paths.get(game.archive)?.get(wanted.toLowerCase()) ?? wanted;
      return member(game, file, path);
    },
  };
}

function unreadableIndex(): HandmadeMapError {
  return {
    code: "manifest-json",
    message: "The file could not be read from the game archive.",
  };
}
