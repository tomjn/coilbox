/**
 * Getting a model picked out of a game onto disk, so the ordinary import can
 * read it.
 *
 * A `.sdd` game is already a folder, so its models are files and there is
 * nothing to do: the path is the archive's folder plus the member, and
 * `lego_import_s3o` finds the textures by walking up to `unittextures/` exactly
 * as it does for a file picked by hand. A `.sdz`, `.sd7` or rapid `.sdp` holds
 * the same bytes with no path to them, so the member is unpacked into a temp
 * folder shaped like a game, `objects3d/` beside `unittextures/`, and the same
 * walk then works unchanged.
 *
 * That is why this is a route in rather than a second reader: everything past
 * here is `rawImport.ts` and the commands it already uses, whichever kind of
 * archive the model came out of.
 */

import { join, tempDir } from "@tauri-apps/api/path";

import type { ArchiveFileEntry } from "../content/bindings";
import { unitsyncArchiveExtract } from "../content/bindings";
import { isLooseArchive } from "./model";

/** The extensions `find_beside_model` will accept in place of the one a model's
 *  header names, kept in step with `texture.rs`. */
const TEXTURE_EXTS = ["dds", "png", "tga", "bmp", "jpg", "jpeg"];

/** Which engine install reads the archive. */
export interface UnitsyncTarget {
  enginePath: string;
  dataDir: string;
}

/** A model somebody picked, by the archive it is in and where in it. */
export interface PickedModel {
  /** The game's primary archive, as unitsync knows it. */
  archive: string;
  /** The archive's own path on disk, which for a `.sdd` is the game folder. */
  archivePath?: string;
  /** The model's member path inside the archive. */
  member: string;
}

/** A model ready to be read, and the folder to forget about afterwards. */
export interface StagedModel {
  /** The `.s3o` on disk. */
  path: string;
  /** The temp folder it was unpacked into, or null for a loose game read in
   *  place. */
  staged: string | null;
}

/**
 * What the project records as where the model came from.
 *
 * A real path for a loose game. For a packed one, the archive's path with the
 * member appended, which describes where the model is rather than pointing at a
 * file anything could open.
 */
export function modelSource(picked: PickedModel): string {
  const root = picked.archivePath ?? picked.archive;
  return `${root.replace(/[\\/]+$/, "")}/${picked.member}`;
}

/**
 * The archive member holding the texture a model's header names, if it holds
 * one.
 *
 * The same rules `find_beside_model` applies to a folder, in the same order:
 * walk up from the model looking for a `unittextures/`, then fall back to the
 * model's own folder. The header's name is reduced to its file name, matched
 * without regard to case, and failing that matched by stem against the other
 * image extensions, because a model asking for a `.dds` is routinely shipped a
 * `.png`.
 *
 * The walk and the fallback are what a map needs. A game keeps its textures in
 * one `unittextures/` at the top, but a map's feature models routinely carry
 * their texture beside them in `objects3d/`, and looking only at the top would
 * unpack a feature untextured.
 */
export function textureMember(
  files: ArchiveFileEntry[],
  name: string,
  /** The model's own member path, which the search starts from. */
  member: string,
): string | null {
  const want = name.trim().replace(/\\/g, "/").split("/").at(-1)?.toLowerCase();
  if (!want) return null;

  /** Every member by folder, lower cased, so a folder can be searched at all. */
  const byFolder = new Map<string, Map<string, string>>();
  for (const file of files) {
    const path = file.path.replace(/\\/g, "/");
    const cut = path.lastIndexOf("/");
    const folder = cut === -1 ? "" : path.slice(0, cut + 1).toLowerCase();
    const base = path.slice(cut + 1).toLowerCase();
    let here = byFolder.get(folder);
    if (!here) {
      here = new Map();
      byFolder.set(folder, here);
    }
    if (!here.has(base)) here.set(base, path);
  }

  const stem = want.includes(".") ? want.slice(0, want.lastIndexOf(".")) : want;
  for (const folder of searchFolders(member)) {
    const here = byFolder.get(folder);
    if (!here) continue;
    const exact = here.get(want);
    if (exact) return exact;
    for (const ext of TEXTURE_EXTS) {
      const hit = here.get(`${stem}.${ext}`);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * The folders a model's texture is looked for in, nearest first.
 *
 * Every `unittextures/` from the model's own folder up to the archive's root,
 * then the model's folder itself. Lower cased, with a trailing slash, so it can
 * be compared against a member's folder directly.
 */
function searchFolders(member: string): string[] {
  const parts = member
    .replace(/\\/g, "/")
    .toLowerCase()
    .split("/")
    .slice(0, -1);
  const folders: string[] = [];
  for (let depth = parts.length; depth >= 0; depth -= 1) {
    folders.push([...parts.slice(0, depth), "unittextures", ""].join("/"));
  }
  folders.push(parts.length === 0 ? "" : `${parts.join("/")}/`);
  return folders;
}

/**
 * Put the model where it can be read from.
 *
 * A loose game answers immediately with the file it already has. A packed one
 * costs one member extraction, into a folder named after nothing but a fresh
 * id, so two imports of one model never land on each other.
 *
 * The temp folder is left for the OS to reclaim rather than deleted, which is
 * what the campaign media import does with its own extracted files. There is no
 * delete-file command exposed to the frontend, and adding one for this alone
 * would be more to go wrong than a few megabytes in the temp folder.
 */
export async function stageModel(
  target: UnitsyncTarget,
  picked: PickedModel,
): Promise<StagedModel> {
  if (isLooseArchive(picked.archive) && picked.archivePath) {
    return {
      path: await join(picked.archivePath, picked.member),
      staged: null,
    };
  }
  const staged = await join(
    await tempDir(),
    `coilbox-lego-model-${crypto.randomUUID()}`,
  );
  const path = await join(staged, "objects3d", modelFileName(picked.member));
  await extract(target, picked.archive, picked.member, path);
  return { path, staged };
}

/**
 * Unpack the textures a staged model's header names, beside it.
 *
 * Nothing to do for a loose game, whose textures never moved. For a packed one
 * this is what makes the import's own walk up to `unittextures/` find anything,
 * so a model opened out of a `.sdz` arrives painted rather than grey.
 *
 * A texture the archive does not hold is not an error. The import already
 * reports a named-but-missing texture and offers to point at one, which is the
 * same answer a loose game with a missing file gives.
 */
export async function stageTextures(
  target: UnitsyncTarget,
  picked: PickedModel,
  staged: StagedModel,
  files: ArchiveFileEntry[],
  names: string[],
): Promise<void> {
  if (!staged.staged) return;
  const done = new Set<string>();
  for (const name of names) {
    const member = textureMember(files, name, picked.member);
    if (!member || done.has(member)) continue;
    done.add(member);
    const dest = await join(
      staged.staged,
      "unittextures",
      member.split("/").at(-1) ?? member,
    );
    await extract(target, picked.archive, member, dest);
  }
}

/** The file name to unpack a member under, keeping its own name so the imported
 *  unit is called what the game calls it. */
function modelFileName(member: string): string {
  return member.replace(/\\/g, "/").split("/").at(-1) ?? member;
}

async function extract(
  target: UnitsyncTarget,
  archive: string,
  file: string,
  dest: string,
): Promise<void> {
  const result = await unitsyncArchiveExtract({
    ...target,
    archive,
    file,
    dest,
  });
  if (result.errors.length > 0) throw new Error(result.errors.join(". "));
}
