import {
  assetUrl,
  conquestMapStagingUrl,
  conquestMapUrl,
} from "../../lib/assetUrl";
import {
  conquestMapCommit,
  conquestMapDiscard,
  conquestMapList,
  conquestMapRemove,
  conquestMapStage,
  type HandmadeMapItem,
} from "../bindings";
import type { GalaxyDoc } from "../model";
import {
  type ArchiveMapItem,
  type ArchiveReader,
  type ArchiveTarget,
  createArchiveReader,
} from "./archive";
import { memoryTraceCache } from "./cache";
import { decodeRgba, imageSize } from "./decode";
import type { HandmadeMapError } from "./errors";
import { gltfSiblings } from "./gltf";
import {
  MANIFEST_FILE,
  type MapManifest,
  parseManifest,
  type ResolvedManifest,
} from "./manifest";
import { type HandmadeMapResult, readHandmadeMap } from "./read";

/**
 * The hand-made maps coilbox holds: the ones bundled with a distribution in
 * `.coilbox/galaxies/`, the ones an installed game carries in its archive (see
 * `./archive`), and the ones a player imported from a zip. The plugin finds
 * the folders and unpacks zips. This module turns a folder into a galaxy
 * through the reader.
 *
 * When two sources have a map with the same id, the player sees one of them:
 * a bundled map first, then a map a game carries, then an imported one. The
 * first two cannot be replaced, so an import never hides them. Between two
 * games, the newer version wins.
 */

export type HandmadeMapSource = "imported" | "bundled" | "game";

/** Which source a player sees when two have a map with the same id. */
const RANK: Record<HandmadeMapSource, number> = {
  imported: 0,
  game: 1,
  bundled: 2,
};

/** Enough of a map to list it. The picture is absent when its file is. */
export interface HandmadeMapSummary {
  id: string;
  title: string;
  description?: string;
  game: MapManifest["game"];
  source: HandmadeMapSource;
  /** The game whose archive carries the map, by name. Only for `game`. */
  carriedBy?: string;
  pictureUrl?: string;
  /** Whether the author marked a Warpath start and goal. Without them the map
   * is for Conquest only. */
  warpath: boolean;
}

/** A map folder whose manifest cannot be listed, with the reader's reasons. */
export interface UnreadableHandmadeMap {
  folder: string;
  source: HandmadeMapSource;
  /** The game whose archive holds the folder. Only for `game`. */
  carriedBy?: string;
  errors: HandmadeMapError[];
}

export interface HandmadeMapList {
  maps: HandmadeMapSummary[];
  unreadable: UnreadableHandmadeMap[];
  /**
   * The games that ask for their own maps only, by name. The generated styles
   * are not offered for them while they carry a map that can be listed.
   */
  onlyOwnMaps: string[];
  /** Why the game archives could not be searched, when they could not. */
  archiveError?: string;
}

/**
 * Where game archives are read from. Undefined until the app has resolved its
 * engine, null when there is none. Set by `useHandmadeMaps`.
 */
let archiveTarget: ArchiveTarget | null | undefined;
let archiveReader: ArchiveReader | null = null;

/**
 * Point the library at the engine and content root the game archives are read
 * with, and drop everything read from them before. Null means there is no
 * engine, so no game carries a map.
 */
export function setArchiveTarget(target: ArchiveTarget | null): void {
  archiveReader?.dispose();
  archiveTarget = target;
  archiveReader = target ? createArchiveReader(target) : null;
}

/** Whether the archive target has been set yet. */
export function archiveTargetKnown(): boolean {
  return archiveTarget !== undefined;
}

/** Bundled map folders sit beside the bundled galaxy files. */
const BUNDLED_DIR = "galaxies";

/** Traces kept for the session, so importing and then opening a map traces once. */
const traces = memoryTraceCache();

type UrlFor = (fileName: string) => string | undefined;

/** A `urlFor` that answers only for files the folder holds. */
function urlsOf(files: string[], url: (file: string) => string): UrlFor {
  const held = new Set(files);
  return (file) => (held.has(file) ? url(file) : undefined);
}

function installedUrls(item: HandmadeMapItem): UrlFor {
  return urlsOf(item.files, (file) =>
    item.source === "bundled"
      ? assetUrl(`${BUNDLED_DIR}/${item.folder}/${file}`)
      : conquestMapUrl(item.folder, file),
  );
}

/**
 * The resolver for the other files of the map folder that `imageUrl` points
 * into, where `imageUrl` is the terrain picture of a document the reader made.
 * A placed model's `file` goes through it. It answers `undefined` for a name
 * the folder does not hold, and the whole call answers `undefined` when no
 * installed map has that picture.
 */
export async function handmadeMapFileUrls(
  imageUrl: string,
): Promise<UrlFor | undefined> {
  const { items } = await conquestMapList({});
  for (const item of items) {
    const urlFor = installedUrls(item);
    if (item.files.some((file) => urlFor(file) === imageUrl)) return urlFor;
  }
  return carriedModelUrls(imageUrl);
}

/**
 * The same for a map a game carries, answering for the model files its
 * `map.json` places. They are read out of the archive here, so the answer
 * can be given at once. The reader read them when the map was opened, so
 * this reads nothing again.
 */
async function carriedModelUrls(imageUrl: string): Promise<UrlFor | undefined> {
  const reader = archiveReader;
  if (!reader) return undefined;
  for (const carried of (await reader.list()).items) {
    const { manifest } = parseManifest(carried.manifest);
    if (!manifest || !carried.files.includes(manifest.files.picture)) continue;
    const { game, folder } = carried;
    const picture = await reader.read(game, folder, manifest.files.picture);
    if (!picture.ok || picture.url !== imageUrl) continue;
    const urls = new Map<string, string>();
    for (const placed of manifest.models) {
      if (!("file" in placed.model)) continue;
      const { file } = placed.model;
      if (!carried.files.includes(file)) continue;
      const read = await reader.read(game, folder, file);
      if (read.ok) urls.set(file, read.url);
    }
    return (file) => urls.get(file);
  }
  return undefined;
}

type Listed = { summary: HandmadeMapSummary; manifest: string } & (
  | { item: HandmadeMapItem; archive?: undefined }
  | { item?: undefined; archive: ArchiveMapItem }
);

async function listFolders(): Promise<{
  listed: Listed[];
  unreadable: UnreadableHandmadeMap[];
  onlyOwnMaps: string[];
  archiveError?: string;
}> {
  const { items } = await conquestMapList({});
  const reader = archiveReader;
  let archive: Awaited<ReturnType<ArchiveReader["list"]>> = {
    items: [],
    unreadable: [],
    onlyOwnMaps: [],
  };
  let archiveError: string | undefined;
  if (reader) {
    try {
      archive = await reader.list();
    } catch (e) {
      archiveError = messageOf(e);
    }
  }
  const byId = new Map<string, Listed>();
  const unreadable: UnreadableHandmadeMap[] = archive.unreadable.map((u) => ({
    folder: u.folder,
    source: "game",
    carriedBy: u.game.name,
    errors: u.errors,
  }));
  const keep = (next: Listed) => {
    const held = byId.get(next.summary.id);
    if (held && RANK[held.summary.source] >= RANK[next.summary.source]) return;
    byId.set(next.summary.id, next);
  };
  for (const carried of archive.items) {
    const { folder, game } = carried;
    const { manifest, errors } = parseManifest(carried.manifest);
    const fail = (errors: HandmadeMapError[]) =>
      unreadable.push({ folder, source: "game", carriedBy: game.name, errors });
    if (!manifest) {
      fail(errors);
      continue;
    }
    // A map a game carries is for that game.
    if (
      manifest.game.shortname.toLowerCase() !== game.shortname.toLowerCase()
    ) {
      fail([
        {
          code: "manifest-field",
          path: "game.shortname",
          message: `${MANIFEST_FILE}: the game shortname "${manifest.game.shortname}" is not "${game.shortname}", the shortname of the game that carries the map.`,
        },
      ]);
      continue;
    }
    const picture = carried.files.includes(manifest.files.picture)
      ? await reader?.read(game, folder, manifest.files.picture)
      : undefined;
    keep({
      archive: carried,
      manifest: carried.manifest,
      summary: {
        id: manifest.id,
        title: manifest.title,
        description: manifest.description,
        game: manifest.game,
        source: "game",
        carriedBy: game.name,
        pictureUrl: picture?.ok ? picture.url : undefined,
        warpath: manifest.warpath !== undefined,
      },
    });
  }
  for (const item of items) {
    const { folder, source } = item;
    const { manifest, errors } = parseManifest(item.manifest);
    if (!manifest) {
      unreadable.push({ folder, source, errors });
      continue;
    }
    // An imported map is stored under its id. One that is not was put there
    // by hand, and removing it by id would miss the folder.
    if (source === "imported" && manifest.id !== folder) {
      unreadable.push({
        folder,
        source,
        errors: [
          {
            code: "manifest-field",
            path: "id",
            message: `${MANIFEST_FILE}: the id "${manifest.id}" does not match the folder "${folder}" the map is stored in.`,
          },
        ],
      });
      continue;
    }
    keep({
      item,
      manifest: item.manifest,
      summary: {
        id: manifest.id,
        title: manifest.title,
        description: manifest.description,
        game: manifest.game,
        source,
        pictureUrl: installedUrls(item)(manifest.files.picture),
        warpath: manifest.warpath !== undefined,
      },
    });
  }
  // Only a game that carries a map it can list loses the generated styles,
  // so a game whose maps all fail to read is still playable.
  const listed = [...byId.values()];
  const onlyOwnMaps = archive.onlyOwnMaps.filter((name) =>
    listed.some((l) => l.summary.carriedBy === name),
  );
  return { listed, unreadable, onlyOwnMaps, archiveError };
}

/**
 * Every hand-made map, checked only as far as its manifest. A folder whose
 * manifest does not parse is returned in `unreadable` with the reader's errors.
 */
export async function listHandmadeMaps(): Promise<HandmadeMapList> {
  const { listed, unreadable, onlyOwnMaps, archiveError } = await listFolders();
  return {
    maps: listed.map((l) => l.summary),
    unreadable,
    onlyOwnMaps,
    ...(archiveError === undefined ? {} : { archiveError }),
  };
}

/**
 * The `.gltf` models in `map.json` whose `.bin` or image files are not in the
 * folder, one error for each file. A model file that cannot be fetched or is
 * not JSON is left alone: the view reports that when it loads the model.
 */
async function missingModelFiles(
  manifest: ResolvedManifest,
  urlFor: UrlFor,
): Promise<HandmadeMapError[]> {
  const errors: HandmadeMapError[] = [];
  const seen = new Set<string>();
  for (const [i, placed] of manifest.models.entries()) {
    if (!("file" in placed.model)) continue;
    const { file } = placed.model;
    const url = urlFor(file);
    if (url === undefined || !/\.gltf$/i.test(file)) continue;
    let text: string;
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      text = await response.text();
    } catch {
      continue;
    }
    for (const { path, outside } of gltfSiblings(text, file)) {
      if (!outside && urlFor(path) !== undefined) continue;
      const key = `${file}\0${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({
        code: "file-missing",
        file: path,
        message: outside
          ? `${MANIFEST_FILE}: models[${i}] names the model "${file}", which points at "${path}" outside the map folder. Put the file in the folder and point at it there.`
          : `${MANIFEST_FILE}: models[${i}] names the model "${file}", which needs the file "${path}", but the folder has no file with that name.`,
      });
    }
  }
  return errors;
}

/** Decode a folder's images and run the reader on it. */
async function readFolder(
  manifestText: string,
  urlFor: UrlFor,
): Promise<HandmadeMapResult> {
  const { manifest, errors } = parseManifest(manifestText);
  if (!manifest) return { ok: false, errors };

  const missing: HandmadeMapError[] = [];
  const need = (what: string, file: string): string | undefined => {
    const url = urlFor(file);
    if (url === undefined) {
      missing.push({
        code: "file-missing",
        file,
        message: `${MANIFEST_FILE} names the ${what} "${file}", but the folder has no file with that name.`,
      });
    }
    return url;
  };
  const provincesUrl = need("province image", manifest.files.provinces);
  const pictureUrl = need("picture", manifest.files.picture);
  if (provincesUrl === undefined || pictureUrl === undefined) {
    return { ok: false, errors: missing };
  }

  const unreadable: HandmadeMapError[] = [];
  const decode = async <T>(
    file: string,
    run: () => Promise<T>,
  ): Promise<T | undefined> => {
    try {
      return await run();
    } catch {
      unreadable.push({
        code: "image-unreadable",
        file,
        message: `"${file}" could not be opened as an image. Save it again as a PNG.`,
      });
      return undefined;
    }
  };
  // A heightmap the folder lacks is left for the reader to report as missing.
  const { heightmap } = manifest.files;
  const heightmapUrl = heightmap === undefined ? undefined : urlFor(heightmap);
  const scenarioFiles = new Set(
    [...manifest.provinces, ...manifest.locations].flatMap((l) =>
      l.scenario === undefined ? [] : [l.scenario],
    ),
  );
  // Started here so the files are fetched while the images decode.
  const scenarioReads = Promise.all(
    [...scenarioFiles].map(
      async (file): Promise<[string, string | undefined]> => [
        file,
        await fileText(urlFor(file)),
      ],
    ),
  );
  const [provinces, picture, heights] = await Promise.all([
    decode(manifest.files.provinces, () => decodeRgba(provincesUrl)),
    decode(manifest.files.picture, () => imageSize(pictureUrl)),
    heightmap === undefined || heightmapUrl === undefined
      ? Promise.resolve(true)
      : decode(heightmap, () => imageSize(heightmapUrl)),
  ]);
  if (!provinces || !picture || !heights) {
    return { ok: false, errors: unreadable };
  }

  // A scenario file that is missing or would not read is left out, and the
  // reader says which location it belongs to.
  const scenarios: Record<string, string> = {};
  for (const [file, text] of await scenarioReads) {
    if (text !== undefined) scenarios[file] = text;
  }

  const read = readHandmadeMap({
    manifest: manifestText,
    provinces,
    picture,
    urlFor,
    scenarios,
    cache: traces,
  });
  const modelErrors = await missingModelFiles(manifest, urlFor);
  if (modelErrors.length === 0) return read;
  return {
    ok: false,
    errors: [...(read.ok ? [] : read.errors), ...modelErrors],
  };
}

/** The text of a file in a map folder, or undefined when it cannot be read. */
async function fileText(url: string | undefined): Promise<string | undefined> {
  if (url === undefined) return undefined;
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read one installed map into a galaxy. On failure the errors are the
 * reader's own, untouched. An id no map has is reported the same way.
 */
export async function loadHandmadeMap(id: string): Promise<HandmadeMapResult> {
  const { listed } = await listFolders();
  const found = listed.find((l) => l.summary.id === id);
  if (!found) {
    return {
      ok: false,
      errors: [
        {
          code: "file-missing",
          file: MANIFEST_FILE,
          message: `No hand-made map with the id "${id}" is installed, and no installed game carries one. A game update may have removed it.`,
        },
      ],
    };
  }
  if (found.item) return readFolder(found.manifest, installedUrls(found.item));
  return readCarried(found.archive);
}

/**
 * Read a map a game carries. Its files are read out of the archive first, so
 * the reader gets URLs as it does for any other folder.
 */
async function readCarried(
  carried: ArchiveMapItem,
): Promise<HandmadeMapResult> {
  const reader = archiveReader;
  const { manifest, errors } = parseManifest(carried.manifest);
  if (!manifest || !reader) return { ok: false, errors };
  const wanted = new Set<string>([
    manifest.files.provinces,
    manifest.files.picture,
    ...(manifest.files.heightmap === undefined
      ? []
      : [manifest.files.heightmap]),
    ...[...manifest.provinces, ...manifest.locations].flatMap((l) =>
      l.scenario === undefined ? [] : [l.scenario],
    ),
    ...manifest.models.flatMap((m) =>
      "file" in m.model ? [m.model.file] : [],
    ),
  ]);
  const urls = new Map<string, string>();
  const failed: HandmadeMapError[] = [];
  for (const file of wanted) {
    // A file the folder lacks is left for the reader to report as missing.
    if (!carried.files.includes(file)) continue;
    const read = await reader.read(carried.game, carried.folder, file);
    if (read.ok) urls.set(file, read.url);
    else failed.push(read.error);
  }
  if (failed.length > 0) return { ok: false, errors: failed };
  const read = await readFolder(carried.manifest, (file) => urls.get(file));
  if (!read.ok) return read;
  return {
    ok: true,
    doc: {
      ...read.doc,
      handmade: {
        ...read.doc.handmade,
        mapId: read.doc.id,
        carriedBy: carried.game.name,
      },
    },
  };
}

export type HandmadeImportResult =
  /** The map is installed. `skipped` counts zip entries that were left out. */
  | { status: "imported"; id: string; doc: GalaxyDoc; skipped: number }
  /** A map with this id is installed. Ask, then import again with `replace`. */
  | { status: "exists"; id: string; title: string }
  /** The zip unpacked but the reader refused the map. Nothing was installed. */
  | { status: "invalid"; errors: HandmadeMapError[] }
  /** The zip itself was refused. `message` is a sentence for the player. */
  | { status: "refused"; message: string };

/**
 * Import a map from the zip at `zipPath`. The zip is unpacked into a staging
 * folder, read there, and installed only when the reader accepts it, so a
 * failed import leaves nothing behind and a failed replace leaves the installed
 * map as it was.
 */
export async function importHandmadeMap(
  zipPath: string,
  options: { replace?: boolean } = {},
): Promise<HandmadeImportResult> {
  let staged: Awaited<ReturnType<typeof conquestMapStage>>;
  try {
    staged = await conquestMapStage({ path: zipPath });
  } catch (e) {
    return { status: "refused", message: messageOf(e) };
  }
  const { token } = staged;
  let committed = false;
  try {
    const read = await readFolder(
      staged.manifest,
      urlsOf(staged.files, (file) => conquestMapStagingUrl(token, file)),
    );
    if (!read.ok) return { status: "invalid", errors: read.errors };
    // A map a game carries cannot be replaced, so an import with its id would
    // never be seen. The plugin refuses a bundled id the same way.
    const { listed } = await listFolders();
    const carried = listed.find(
      (l) => l.summary.id === read.doc.id && l.summary.source === "game",
    );
    if (carried) {
      return {
        status: "refused",
        message: `The game "${carried.summary.carriedBy}" carries a map with the id "${read.doc.id}", and a map a game carries cannot be replaced. Change the id in ${MANIFEST_FILE} and import it again.`,
      };
    }

    const { status, id } = await conquestMapCommit({
      token,
      replace: options.replace ?? false,
    });
    if (status === "exists") {
      return { status: "exists", id, title: read.doc.title };
    }
    committed = true;
    // The document read above points at the staging folder, which is gone
    // now. Read the installed copy. The trace is cached, so this is cheap.
    const installed = await loadHandmadeMap(id);
    if (!installed.ok) {
      // The map is installed but cannot be read back. Take it out again, so
      // "invalid" still means nothing was installed.
      try {
        await conquestMapRemove({ id });
      } catch (e) {
        return {
          status: "refused",
          message: `The map was installed as "${id}" but could not be read back, and taking it out again failed. Remove it from the Conquest page. ${messageOf(e)}`,
        };
      }
      return { status: "invalid", errors: installed.errors };
    }
    return {
      status: "imported",
      id,
      doc: installed.doc,
      skipped: staged.skipped,
    };
  } catch (e) {
    return { status: "refused", message: messageOf(e) };
  } finally {
    if (!committed) await conquestMapDiscard({ token }).catch(() => {});
  }
}

/** Remove an imported map. Throws for a bundled one, which cannot be removed. */
export async function removeHandmadeMap(id: string): Promise<void> {
  await conquestMapRemove({ id });
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
