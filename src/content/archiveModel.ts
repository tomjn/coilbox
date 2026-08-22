/**
 * Which archive members are models, for the archive browser's preview pane.
 *
 * A member's format is a fact about its name, so it is decided here rather than
 * asked of unitsync: the preview command classifies by reading bytes, and a
 * model is neither an image, a clip nor text to it. Naming the format up front
 * also means the browser never spends an archive mount on a file that was never
 * going to draw.
 */

/** The model formats the viewer can draw, which are the two the engine loads. */
export type ModelFormat = "s3o" | "3do";

/**
 * How big a model file the preview will read.
 *
 * The read comes back as a flattened piece tree of JSON floats, several times
 * the size of the file it came from, and it crosses the IPC bridge in one
 * message. The largest model in the games checked is a 3.2 MiB `.s3o`, so this
 * is comfortably above real content and still short of a file that would stall
 * the window.
 */
export const MODEL_PREVIEW_CAP = 8 * 1024 * 1024;

/** The model format of an archive member, or `undefined` when it is not one. */
export function modelFormatFor(path: string): ModelFormat | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".s3o")) return "s3o";
  if (lower.endsWith(".3do")) return "3do";
  return undefined;
}

/** Whether a member is past {@link MODEL_PREVIEW_CAP}. An unknown size is not:
 *  the read is bounded in the worker as well, and refusing to look at a file
 *  because its size did not arrive would be the wrong way round. */
export function modelTooLargeToPreview(size?: number): boolean {
  return size != null && size > MODEL_PREVIEW_CAP;
}
