import { t } from "@lingui/core/macro";
import type { HubGameDownload } from "../hub/api";
import { dlDownloadRaw } from "./bindings";
import type { DownloadAttempt } from "./downloadHistory";
import { withDownloadNotify } from "./downloadNotify";
import { fetchHubFile } from "./hubFileDownload";
import { type ProgressSink, progressChannel } from "./progressChannel";
import {
  AttemptLog,
  isCancel,
  type SourceStep,
  SourceWalkError,
} from "./sourceWalk";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Fetch a hub game from its download sources in the order the hub gave them,
 * moving on to the next when one fails (issue #5260). A failure is a transfer
 * that broke, a repository with nothing to fetch, or a file whose SHA-256 is
 * not the one the hub listed. A mismatching file has already been deleted by the
 * time the next source starts, so nothing unchecked is left in `destDir`.
 *
 * The walk stops at the first source that delivers. Each source tried is an
 * attempt in `onAttempt`, failed or not, so the game's download history shows
 * which ones failed and why. Throws a `SourceWalkError` naming every failure
 * when none delivers, and one carrying the cancel when the player cancels.
 *
 * `rapid` goes to pr-downloader. `url` is fetched directly and checked against
 * its `sha256` when it has one. `github` has its release archives looked up
 * first: a repository with none, or with none matching `asset`, fails that
 * source rather than installing some other release (issue #2859).
 */
async function downloadHubGameImpl(opts: {
  label: string;
  downloads: readonly HubGameDownload[];
  destDir: string;
  /** Pass a stable id to make the active download cancellable via dlCancel. */
  opId?: string;
  onProgress: ProgressSink;
  onAttempt?: (attempt: DownloadAttempt) => void;
  /** Told which source each attempt is on as it starts. */
  onSource?: (step: SourceStep) => void;
}): Promise<void> {
  const { label, downloads, destDir, opId, onProgress } = opts;
  const log = new AttemptLog(opts.onAttempt, opts.onSource);

  for (const dl of downloads) {
    try {
      if (dl.kind === "rapid") {
        log.begin("rapid", { reference: dl.value }, { label: dl.value });
        await dlDownloadRaw({
          tag: dl.value,
          opId,
          onProgress: progressChannel(onProgress),
        });
      } else {
        await fetchHubFile(
          { ...dl, kind: dl.kind },
          {
            destDir,
            opId,
            onProgress,
            log,
          },
        );
      }
      log.ok();
      return;
    } catch (e) {
      if (isCancel(e)) throw new SourceWalkError(msg(e), null);
      log.fail(e);
    }
  }

  const errors = log.errors.join("; ");
  throw new SourceWalkError(
    downloads.length === 0
      ? t`The hub named no download source for ${label}.`
      : t`Every download source for ${label} failed. ${errors}`,
    null,
  );
}

export const downloadHubGame = withDownloadNotify(
  downloadHubGameImpl,
  (o) => o.label,
);
