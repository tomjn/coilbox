import {
  type GameItem,
  unitsyncArchiveFile,
  unitsyncArchiveTree,
} from "../../content/bindings";
import { currentScan } from "../../content/config";
import { withoutGeneratedGames } from "../../lib/generatedGames";
import { compareGameVersions } from "../../play/installedGames";
import {
  type CachedListing,
  cachedListing,
  listingKey,
  rememberListing,
  saveListings,
} from "./archiveCache";
import type { HandmadeMapError } from "./errors";
import { gltfUriEntries, resolveGltfUri } from "./gltf";
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
 *
 * Text and pictures come from unitsync's preview, as data URLs. Model files,
 * and any file the preview cannot return, are read as raw bytes and become
 * blob URLs (issue #3603). The reader revokes those when it is disposed.
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
  /** The archive's size in bytes and CRC, when the scan found them. They are
   * part of the cache key, so an archive changed under the same name is read
   * again. */
  size?: number;
  checksum?: string;
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

/** The archive to search for one installed game. */
export function archiveGameOf(g: GameItem): ArchiveGame {
  return {
    name: g.name,
    archive: g.primaryArchive.name,
    shortname: (g.info.shortname ?? g.name).trim(),
    size: g.primaryArchive.size,
    checksum: g.primaryArchive.checksum,
  };
}

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
    .map(archiveGameOf);
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

/** Model files, which unitsync's preview never returns, so they are read raw. */
const MODEL_FILE = /\.(gltf|glb|bin)$/i;

/** Files read raw whose text the reader also wants. */
const TEXT_FILE = /\.(json|gltf)$/i;

/** The content type of a file read raw, by its extension. */
const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
  gltf: "model/gltf+json",
  glb: "model/gltf-binary",
};

function mimeOf(file: string): string {
  const ext = file.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/** The bytes of a base64 data URL. */
function dataUrlBytes(url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
  /** Every game's listing. Each game is read at most once, and not at all when
   * the cache holds it (see `./archiveCache`). */
  list(): Promise<ArchiveListing>;
  /** One game's listing, from the same source as {@link list}. */
  listGame(game: ArchiveGame): Promise<ArchiveListing>;
  /**
   * Read `file` from the map folder `folder` of `game`. A `.gltf` comes back
   * with the files it names beside itself already read, so it loads from its
   * URL alone.
   */
  read(game: ArchiveGame, folder: string, file: string): Promise<ArchiveRead>;
  /** Revoke the blob URLs the reader made. Its URLs stop loading. */
  dispose(): void;
}

/**
 * A reader over the archives of every installed game. It lists once and reads
 * each file once, so listing and then opening a map does not read it twice.
 * Make a new one to read the archives again.
 */
export function createArchiveReader(target: ArchiveTarget): ArchiveReader {
  let listing: Promise<ArchiveListing> | undefined;
  /** Each game's listing, by archive name, size and CRC, so a game is read once a reader. */
  const oneGame = new Map<string, Promise<ArchiveListing>>();
  const reads = new Map<string, Promise<ArchiveRead>>();
  /** The real path of each member, by archive and the path in lower case. */
  const paths = new Map<string, Map<string, string>>();
  /** Every blob URL made, revoked by `dispose`. */
  const blobs: string[] = [];

  const blobUrl = (part: BlobPart, type: string) => {
    const url = URL.createObjectURL(new Blob([part], { type }));
    blobs.push(url);
    return url;
  };

  const fetchMember = async (game: ArchiveGame, path: string, raw = false) =>
    unitsyncArchiveFile({
      ...target,
      archive: game.archive,
      file: path,
      ...(raw ? { raw } : {}),
    });

  const failed = (file: string, e: unknown) =>
    unreadable(
      file,
      `it could not be read. ${e instanceof Error ? e.message : String(e)}`,
    );

  /** Read a member's own bytes into a blob URL. */
  const readRaw = async (
    game: ArchiveGame,
    file: string,
    path: string,
  ): Promise<ArchiveRead> => {
    let res: Awaited<ReturnType<typeof fetchMember>>;
    try {
      res = await fetchMember(game, path, true);
    } catch (e) {
      return failed(file, e);
    }
    if (res.truncated) {
      return unreadable(
        file,
        "it is larger than 256 MB, the most coilbox reads from a game archive for one file.",
      );
    }
    if (!res.dataUrl) {
      return unreadable(
        file,
        `it could not be read. ${res.errors.join(" ")}`.trim(),
      );
    }
    const bytes = dataUrlBytes(res.dataUrl);
    const url = blobUrl(bytes, mimeOf(file));
    return TEXT_FILE.test(file)
      ? { ok: true, url, text: new TextDecoder().decode(bytes) }
      : { ok: true, url };
  };

  const readMember = async (
    game: ArchiveGame,
    file: string,
    path: string,
  ): Promise<ArchiveRead> => {
    if (MODEL_FILE.test(file)) return readRaw(game, file, path);
    let res: Awaited<ReturnType<typeof fetchMember>>;
    try {
      res = await fetchMember(game, path);
    } catch (e) {
      return failed(file, e);
    }
    if (res.kind === "text" && res.text !== undefined) {
      return { ok: true, url: textUrl(res.text), text: res.text };
    }
    if (res.kind === "image" && res.dataUrl) {
      return { ok: true, url: res.dataUrl };
    }
    if (res.errors.length > 0 && !res.truncated) {
      return unreadable(file, `it could not be read. ${res.errors.join(" ")}`);
    }
    // Too large for a preview, or a kind the preview does not return. The map
    // reader says so when the bytes are not a picture or text it can use.
    return readRaw(game, file, path);
  };

  /**
   * Read a `.gltf` and the files it names beside itself, and point its uris at
   * their URLs. A blob URL has no folder, so a relative uri in it would not
   * load. A named file the folder lacks keeps its uri, and the map reader
   * reports it as missing.
   */
  const readGltf = async (
    game: ArchiveGame,
    folder: string,
    file: string,
  ): Promise<ArchiveRead> => {
    const read = await member(game, file, pathIn(game, folder, file));
    if (!read.ok || read.text === undefined) return read;
    let json: unknown;
    try {
      json = JSON.parse(read.text);
    } catch {
      // The view reports a model it cannot read when it loads it.
      return read;
    }
    let changed = false;
    for (const entry of gltfUriEntries(json)) {
      const found = resolveGltfUri(entry.uri, file);
      if (!found || found.outside) continue;
      const path = paths
        .get(game.archive)
        ?.get(`${ARCHIVE_MAPS_DIR}/${folder}/${found.path}`.toLowerCase());
      if (path === undefined) continue;
      const sibling = await member(game, found.path, path);
      if (!sibling.ok) return sibling;
      entry.uri = sibling.url;
      changed = true;
    }
    if (!changed) return read;
    return { ok: true, url: blobUrl(JSON.stringify(json), mimeOf(file)) };
  };

  /**
   * Read one game's archive: its member list, `index.json` and the manifests.
   * `cacheable` is false when any read failed, since a failure may pass and the
   * next read should try again.
   */
  const readListing = async (
    game: ArchiveGame,
  ): Promise<{ listing: CachedListing; cacheable: boolean }> => {
    const listing: CachedListing = {
      items: [],
      unreadable: [],
      onlyOwnMaps: false,
      members: [],
    };
    let tree: Awaited<ReturnType<typeof unitsyncArchiveTree>>;
    try {
      tree = await unitsyncArchiveTree({ ...target, archive: game.archive });
    } catch {
      // A game whose archive will not open carries nothing coilbox can read.
      return { listing, cacheable: false };
    }
    let cacheable = true;
    const prefix = `${ARCHIVE_MAPS_DIR}/`;
    const folders = new Map<string, string[]>();
    let index: string | undefined;
    for (const { path } of tree.files) {
      if (path.endsWith("/")) continue;
      if (!path.toLowerCase().startsWith(prefix)) continue;
      listing.members.push(path);
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
    rememberPaths(game, listing.members);

    if (index !== undefined) {
      const read = await member(game, ARCHIVE_INDEX_FILE, index);
      const text = read.ok ? read.text : undefined;
      if (text === undefined) cacheable = false;
      const parsed =
        text === undefined
          ? {
              onlyOwnMaps: false,
              errors: [read.ok ? unreadableIndex() : read.error],
            }
          : parseArchiveIndex(text);
      listing.onlyOwnMaps = parsed.onlyOwnMaps;
      if (parsed.errors.length > 0) {
        listing.unreadable.push({
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
        cacheable = false;
        listing.unreadable.push({
          folder,
          errors: [read.ok ? unreadableIndex() : read.error],
        });
        continue;
      }
      listing.items.push({ folder, files: files.sort(), manifest });
    }
    return { listing, cacheable };
  };

  /** Remember the real path of each member, by its lower case path. */
  const rememberPaths = (game: ArchiveGame, members: readonly string[]) => {
    paths.set(game.archive, new Map(members.map((m) => [m.toLowerCase(), m])));
  };

  const listOne = async (game: ArchiveGame): Promise<ArchiveListing> => {
    const key = listingKey(target, game);
    const cached = key === null ? undefined : cachedListing(key);
    let listing: CachedListing;
    if (cached) {
      listing = cached;
      rememberPaths(game, cached.members);
    } else {
      const read = await readListing(game);
      listing = read.listing;
      if (key !== null && read.cacheable) rememberListing(key, listing);
    }
    return {
      items: listing.items.map((i) => ({ ...i, game })),
      unreadable: listing.unreadable.map((u) => ({ ...u, game })),
      onlyOwnMaps: listing.onlyOwnMaps ? [game.name] : [],
    };
  };

  const pathIn = (game: ArchiveGame, folder: string, file: string) => {
    const wanted = `${ARCHIVE_MAPS_DIR}/${folder}/${file}`;
    return paths.get(game.archive)?.get(wanted.toLowerCase()) ?? wanted;
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

  const reader: ArchiveReader = {
    list() {
      listing ??= (async () => {
        const out: ArchiveListing = {
          items: [],
          unreadable: [],
          onlyOwnMaps: [],
        };
        const scan = await currentScan(target.enginePath, target.dataDir);
        const games = archiveGames(scan.games);
        try {
          // One game at a time: each read starts unitsync, and several at once
          // would all scan the same content root together.
          for (const game of games) {
            const one = await reader.listGame(game);
            out.items.push(...one.items);
            out.unreadable.push(...one.unreadable);
            out.onlyOwnMaps.push(...one.onlyOwnMaps);
          }
        } finally {
          saveListings(games.map((g) => listingKey(target, g)));
        }
        return out;
      })();
      return listing;
    },
    listGame(game) {
      const key = `${game.archive}\0${game.size ?? ""}\0${game.checksum ?? ""}`;
      let one = oneGame.get(key);
      if (!one) {
        one = listOne(game);
        oneGame.set(key, one);
      }
      return one;
    },
    async read(game, folder, file) {
      const path = pathIn(game, folder, file);
      if (!/\.gltf$/i.test(file)) return member(game, file, path);
      // Kept apart from the plain read of the same file, which it starts from.
      const key = `gltf\0${game.archive}\0${path.toLowerCase()}`;
      let read = reads.get(key);
      if (!read) {
        read = readGltf(game, folder, file);
        reads.set(key, read);
      }
      return read;
    },
    dispose() {
      for (const url of blobs.splice(0)) URL.revokeObjectURL(url);
    },
  };
  return reader;
}

function unreadableIndex(): HandmadeMapError {
  return {
    code: "manifest-json",
    message: "The file could not be read from the game archive.",
  };
}
