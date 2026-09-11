/**
 * The link from a member of an archive to that member open in the builder.
 *
 * The archive browser can already draw a `.s3o` it is looking at (#698), and the
 * builder can already open one out of a game (#1817). All that was missing was a
 * way across, so this is the address of that road and nothing else: the browser
 * builds a link, and `OpenFromArchivePage` reads it back and runs the import the
 * game picker already runs.
 *
 * A link rather than a callback because the two live in different plugins. The
 * builder is gated behind advanced mode and owns every piece of the import, and
 * a URL is the one thing the content plugin can hand it without reaching into
 * it.
 */

/** The builder route that opens an archive member. */
export const BUILDER_OPEN_PATH = "/lego/open";

/** The formats the engine loads through Assimp, which the builder converts on
 *  the way in the way it converts a `.3do`. Without a dot, lower case. */
export const ASSIMP_MODEL_EXTS = ["3ds", "dae", "lwo", "obj", "blend"];

/** Every model format the builder can open out of a game. The two native ones
 *  first, since a game shipping the same model twice is drawn from one of
 *  those. */
export const BUILDER_MODEL_EXTS = ["s3o", "3do", ...ASSIMP_MODEL_EXTS];

/** Model formats the engine draws and the builder cannot open. It has a parser
 *  of its own for these rather than going through Assimp, so reading one would
 *  be a second reader and not another extension above.
 *
 *  Named at all so a model in one of them can be spoken about. A file that is
 *  present and drawn in the game is not a missing model, and calling it one
 *  sends somebody hunting for a file that is sitting in the archive. */
export const ENGINE_ONLY_MODEL_EXTS = ["gltf", "glb"];

const BUILDER_EXT = new RegExp(`\\.(${BUILDER_MODEL_EXTS.join("|")})$`, "i");
const ASSIMP_EXT = new RegExp(`\\.(${ASSIMP_MODEL_EXTS.join("|")})$`, "i");
const ENGINE_ONLY_EXT = new RegExp(
  `\\.(${ENGINE_ONLY_MODEL_EXTS.join("|")})$`,
  "i",
);
// Every model extension, openable here or not. Stripping has to know them all:
// a key built from a `.gltf` that kept its extension would match no unitdef's
// `objectname` and the model would read as absent rather than as unopenable.
const ANY_MODEL_EXT = new RegExp(
  `\\.(${[...BUILDER_MODEL_EXTS, ...ENGINE_ONLY_MODEL_EXTS].join("|")})$`,
  "i",
);

/** Whether a file name is a model the builder could open. */
export function isBuilderModel(path: string): boolean {
  return BUILDER_EXT.test(path);
}

/** Whether it is one of the formats read through Assimp, which are converted
 *  rather than read as they stand. */
export function isAssimpModel(path: string): boolean {
  return ASSIMP_EXT.test(path);
}

/** A model's file name without its extension, for a key or a label. */
export function withoutModelExtension(name: string): string {
  return name.replace(ANY_MODEL_EXT, "");
}

/** Whether the engine would draw this model while the builder cannot open it. */
export function isEngineOnlyModel(path: string): boolean {
  return ENGINE_ONLY_EXT.test(path);
}

/** What an open request names, once it has been read back off the URL. */
export interface ArchiveOpenRequest {
  /** The archive, as unitsync names it, e.g. `comet_catcher_remake.sd7`. */
  archive: string;
  /** The model's member path inside it, e.g. `objects3d/rock.s3o`. */
  member: string;
  /**
   * What to call the archive in the units list, e.g. `Comet Catcher Remake`.
   *
   * Carried across rather than looked up again. The browser has already scanned
   * and knows the game or map name behind the file name, and asking unitsync a
   * second time would make the import wait on a scan for a label.
   */
  name?: string;
}

/**
 * Whether the builder could open a member at all.
 *
 * The two native formats and the five the engine loads through Assimp. Only an
 * `.s3o` is read as it stands. A `.3do` and a Collada file are each converted
 * on the way in, and land in the builder the same way.
 */
export function openableInBuilder(member: string): boolean {
  return isBuilderModel(member);
}

/** Where to send somebody who wants this member open in the builder. */
export function builderOpenUrl(request: ArchiveOpenRequest): string {
  const params = new URLSearchParams({
    archive: request.archive,
    member: request.member,
  });
  // Only when it says something the archive's own file name does not.
  if (request.name && request.name !== request.archive) {
    params.set("name", request.name);
  }
  return `${BUILDER_OPEN_PATH}?${params}`;
}

/**
 * The request a URL carries, or null when it does not carry a whole one.
 *
 * Null rather than a partial request, because a half-named model is not
 * something to guess at: the page says it was not told what to open instead of
 * reading whatever it can.
 */
export function openRequest(
  params: URLSearchParams,
): ArchiveOpenRequest | null {
  const archive = params.get("archive")?.trim() ?? "";
  const member = params.get("member")?.trim() ?? "";
  const name = params.get("name")?.trim() ?? "";
  if (!archive || !member) return null;
  return { archive, member, ...(name ? { name } : {}) };
}

/** What the opened unit is called: the model's own file name, as the file
 *  dialog's import names one. */
export function modelName(member: string): string {
  const file = member.replace(/\\/g, "/").split("/").at(-1) ?? member;
  return file.replace(/\.(s3o|3do)$/i, "");
}
