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
import { memoryTraceCache } from "./cache";
import { decodeRgba, imageSize } from "./decode";
import type { HandmadeMapError } from "./errors";
import { MANIFEST_FILE, type MapManifest, parseManifest } from "./manifest";
import { type HandmadeMapResult, readHandmadeMap } from "./read";

/**
 * The hand-made maps coilbox holds: the ones bundled with a distribution in
 * `.coilbox/galaxies/` and the ones a player imported from a zip. The plugin
 * finds the folders and unpacks zips. This module turns a folder into a
 * galaxy through the reader.
 */

export type HandmadeMapSource = "imported" | "bundled";

/** Enough of a map to list it. The picture is absent when its file is. */
export interface HandmadeMapSummary {
  id: string;
  title: string;
  description?: string;
  game: MapManifest["game"];
  source: HandmadeMapSource;
  pictureUrl?: string;
  /** Whether the author marked a Warpath start and goal. Without them the map
   * is for Conquest only. */
  warpath: boolean;
}

/** A map folder whose manifest cannot be listed, with the reader's reasons. */
export interface UnreadableHandmadeMap {
  folder: string;
  source: HandmadeMapSource;
  errors: HandmadeMapError[];
}

export interface HandmadeMapList {
  maps: HandmadeMapSummary[];
  unreadable: UnreadableHandmadeMap[];
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
  return undefined;
}

interface Listed {
  item: HandmadeMapItem;
  summary: HandmadeMapSummary;
}

async function listFolders(): Promise<{
  listed: Listed[];
  unreadable: UnreadableHandmadeMap[];
}> {
  const { items } = await conquestMapList({});
  const byId = new Map<string, Listed>();
  const unreadable: UnreadableHandmadeMap[] = [];
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
    // Imported maps are listed first. A bundled map with the same id takes
    // its place, because a bundled map cannot be replaced.
    if (byId.has(manifest.id) && source !== "bundled") continue;
    byId.set(manifest.id, {
      item,
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
  return { listed: [...byId.values()], unreadable };
}

/**
 * Every hand-made map, checked only as far as its manifest. A folder whose
 * manifest does not parse is returned in `unreadable` with the reader's errors.
 */
export async function listHandmadeMaps(): Promise<HandmadeMapList> {
  const { listed, unreadable } = await listFolders();
  return { maps: listed.map((l) => l.summary), unreadable };
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
  const [provinces, picture] = await Promise.all([
    decode(manifest.files.provinces, () => decodeRgba(provincesUrl)),
    decode(manifest.files.picture, () => imageSize(pictureUrl)),
  ]);
  if (!provinces || !picture) return { ok: false, errors: unreadable };

  return readHandmadeMap({
    manifest: manifestText,
    provinces,
    picture,
    urlFor,
    cache: traces,
  });
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
          message: `No hand-made map with the id "${id}" is installed.`,
        },
      ],
    };
  }
  return readFolder(found.item.manifest, installedUrls(found.item));
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
