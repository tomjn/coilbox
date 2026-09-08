/**
 * Which archive folder a definition's asset path is read from, and whether the
 * file it names is really there.
 *
 * A unit definition points at a model, a script and a picture by writing a
 * fragment of a path: `objectname = "ARMCOM"` in Balanced Annihilation and
 * `objectname = "Units/ARMAAK.s3o"` in Beyond All Reason both name a member of
 * `objects3d/`. The engine, not the definition, supplies the folder and, when
 * the fragment has no extension at all, the extension too. That resolution is
 * what this module reproduces, so a picker can offer the right files and a field
 * can say when the file it names is not in the archive.
 *
 * The folders and extensions are the engine's, taken from its own source:
 *
 *   - Models: `CModelLoader::FindModelPath` in
 *     `rts/Rendering/Models/IModelParser.cpp`, which appends each registered
 *     parser's extension to an extensionless name and then looks under
 *     `objects3d/`. The extensions are the four `RegisterModelFormats` adds
 *     directly plus the five in `CheckAssimpWhitelist`.
 *   - Build pictures: `CUnitDrawerData` in `rts/Rendering/Units/UnitDrawerData.cpp`,
 *     which loads `"unitpics/" + texName` and, with no name given, falls back
 *     through `.dds`, `.png`, `.pcx` and `.bmp`. The three extra extensions here
 *     are formats the image loader reads and games ship.
 *   - Scripts: `scripts/`, which is the one folder a unit script is loaded from.
 *     `crates/coilbox-unitsync-worker/src/unitscriptfile.rs` already resolves
 *     one this way and its tests are the record of the rule.
 *
 * Nothing here is a list of field names. Which fields hold a path is a separate
 * question, answered in `src/workshop/assetFields.ts`.
 */
import type { ArchiveFileEntry } from "./bindings";

/** The kinds of asset a definition names by path. */
export type AssetKindId = "model" | "script" | "picture";

/** Where the engine reads one kind of asset from. */
export interface AssetKind {
  id: AssetKindId;
  /** What to call this kind in the interface. */
  label: string;
  /** How to describe one file of it, for a button that offers to pick one. */
  noun: string;
  /** The archive folder the engine looks in, with no trailing slash. */
  root: string;
  /** Extensions the engine's loader for this kind reads, lowercased, with the
   *  dot. In the order the engine tries them where it tries several. */
  extensions: string[];
}

export const ASSET_KINDS: Record<AssetKindId, AssetKind> = {
  model: {
    id: "model",
    label: "Model",
    noun: "model",
    root: "objects3d",
    extensions: [
      ".3do",
      ".s3o",
      ".gltf",
      ".glb",
      ".3ds",
      ".dae",
      ".lwo",
      ".obj",
      ".blend",
    ],
  },
  script: {
    id: "script",
    label: "Script",
    noun: "script",
    root: "scripts",
    extensions: [".lua", ".cob"],
  },
  picture: {
    id: "picture",
    label: "Picture",
    noun: "picture",
    root: "unitpics",
    extensions: [".dds", ".png", ".pcx", ".bmp", ".tga", ".jpg", ".jpeg"],
  },
};

/** Every extension any kind reads, mapped to the kind that reads it. Only used
 *  where a value's own extension has to say what it is, which is how a field
 *  nobody described gets recognised (see `workshop/assetFields.ts`). */
const KIND_OF_EXTENSION = new Map<string, AssetKindId>();
for (const kind of Object.values(ASSET_KINDS))
  for (const extension of kind.extensions)
    if (!KIND_OF_EXTENSION.has(extension))
      KIND_OF_EXTENSION.set(extension, kind.id);

/** The asset kind a file name's extension belongs to, if any. `.bos` is not one:
 *  it is the source beside a `.cob` rather than anything the engine loads. */
export function assetKindOfPath(path: string): AssetKindId | undefined {
  const at = path.lastIndexOf(".");
  if (at < 0) return undefined;
  return KIND_OF_EXTENSION.get(path.slice(at).toLowerCase());
}

/** An archive's member list, indexed for the two lookups resolution needs. */
export interface AssetIndex {
  /** Every member, as the archive listed them. */
  files: ArchiveFileEntry[];
  /** Lowercased member path, to the path as the archive spells it. */
  byPath: Map<string, string>;
  /** Lowercased file name, to the lowercased paths that end in it. */
  byName: Map<string, string[]>;
}

/** A slash-separated, lowercased, leading-slash-free form of a written path, so
 *  a Windows separator or a `./` prefix does not miss a file that is there. */
function tidy(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
}

export function assetIndex(files: ArchiveFileEntry[]): AssetIndex {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const entry of files) {
    const lower = tidy(entry.path);
    if (!byPath.has(lower)) byPath.set(lower, entry.path);
    const name = lower.split("/").at(-1) ?? lower;
    const at = byName.get(name);
    if (at) at.push(lower);
    else byName.set(name, [lower]);
  }
  return { files, byPath, byName };
}

/** Whether a written path already ends in an extension of any sort. The engine
 *  only appends one when there is none at all, so `arm_normal.dds` is left alone
 *  by the model loader even though `.dds` is not a model. */
const hasExtension = (value: string) => /\.[a-z0-9]+$/.test(value);

/**
 * The archive member a field's value names, or undefined when the archive has
 * no such file.
 *
 * `root` is the folder the value is relative to, which for a described field is
 * the engine's own and for a field read out of the game's data is whichever
 * folder that game's values turned out to sit under.
 *
 * A value that is already a whole member path is accepted as well. The engine
 * accepts one for a model, and for the kinds where it would not, taking it here
 * only means a value we do not warn about rather than a value we would write.
 */
export function resolveAsset(
  index: AssetIndex,
  kind: AssetKind,
  root: string,
  value: string,
): string | undefined {
  const written = tidy(value);
  if (written === "") return undefined;
  const candidates = hasExtension(written)
    ? [written]
    : kind.extensions.map((extension) => written + extension);
  for (const candidate of candidates) {
    const under = root === "" ? candidate : `${root}/${candidate}`;
    const hit = index.byPath.get(under);
    if (hit) return hit;
  }
  for (const candidate of candidates) {
    const hit = index.byPath.get(candidate);
    if (hit) return hit;
  }
  return undefined;
}

/** Where a written value sits, when it names a member somewhere in the archive:
 *  the kind its extension belongs to and the folder it was found under. This is
 *  how a field nobody described is recognised as holding a path. */
export function locateAsset(
  index: AssetIndex,
  value: string,
): { kind: AssetKindId; root: string } | undefined {
  const written = tidy(value);
  const kind = assetKindOfPath(written);
  if (!kind) return undefined;
  const name = written.split("/").at(-1) ?? written;
  for (const member of index.byName.get(name) ?? []) {
    if (member === written) return { kind, root: "" };
    if (member.endsWith(`/${written}`))
      return { kind, root: member.slice(0, -written.length - 1) };
  }
  return undefined;
}

/** Every member a picker for this field should offer: the files under its root
 *  whose extension the engine's loader for that kind reads. */
export function assetChoices(
  index: AssetIndex,
  kind: AssetKind,
  root: string,
): ArchiveFileEntry[] {
  const prefix = root === "" ? "" : `${root}/`;
  return index.files.filter((entry) => {
    const lower = tidy(entry.path);
    if (!lower.startsWith(prefix)) return false;
    return assetKindOfPath(lower) === kind.id;
  });
}

/** What to write into the definition for a member the user picked: the path
 *  with the field's own folder taken off, which is the form every game writes
 *  and the only form the engine accepts for a build picture. */
export function assetValue(root: string, member: string): string {
  const prefix = root === "" ? "" : `${root}/`;
  if (prefix !== "" && tidy(member).startsWith(prefix))
    return member.slice(prefix.length);
  return member;
}
