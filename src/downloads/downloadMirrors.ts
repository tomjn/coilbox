import { dlDownloadFileRaw } from "./bindings";
import { hostOf } from "./downloadHistory";
import { type ProgressSink, progressChannel } from "./progressChannel";
import {
  type AttemptLog,
  isCancel,
  type SourceStep,
  SourceWalkError,
} from "./sourceWalk";

/**
 * Fetch one file from each of its mirrors in turn until one delivers it
 * (issue #4577). The next mirror is tried only after a real download from the
 * one before has failed. Nothing is probed ahead of time.
 *
 * Each mirror is its own attempt in `log`, failed or not. Resolves true once a
 * mirror delivered, with that attempt begun and not yet ended, so the caller
 * ends it. Resolves false when every mirror failed.
 *
 * A cancel stops the walk with a `SourceWalkError` whose `next` is the mirror
 * after the one that was cancelled, or `afterSource` when it was the last.
 *
 * `startAt` skips the mirrors before the host it names. A host the list no
 * longer holds starts at the first.
 */
export async function downloadFromMirrors(o: {
  source: SourceStep["source"];
  urls: readonly string[];
  destDir: string;
  filename: string;
  opId?: string;
  onProgress: ProgressSink;
  log: AttemptLog;
  startAt?: SourceStep;
  afterSource: SourceStep | null;
}): Promise<boolean> {
  const wanted = o.startAt?.source === o.source ? o.startAt.mirror : null;
  const from = wanted ? o.urls.findIndex((u) => hostOf(u) === wanted) : 0;
  const urls = o.urls.slice(Math.max(from, 0));

  for (const [i, url] of urls.entries()) {
    o.log.begin(o.source, {
      reference: url,
      filename: o.filename,
      mirror: hostOf(url),
    });
    try {
      await dlDownloadFileRaw({
        url,
        destDir: o.destDir,
        filename: o.filename,
        opId: o.opId,
        onProgress: progressChannel(o.onProgress),
      });
      return true;
    } catch (e) {
      if (isCancel(e)) {
        const rest = urls[i + 1];
        throw new SourceWalkError(
          e instanceof Error ? e.message : String(e),
          rest ? { source: o.source, mirror: hostOf(rest) } : o.afterSource,
        );
      }
      o.log.fail(e);
    }
  }
  return false;
}
