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
 * Only a `.s3o`. A `.3do` is Total Annihilation's format: the archive browser
 * draws one, because the viewer reads both, but the import reads `.s3o` alone
 * and there is nothing to offer for the older format.
 */
export function openableInBuilder(member: string): boolean {
  return member.toLowerCase().endsWith(".s3o");
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
  return file.replace(/\.s3o$/i, "");
}
