import { t } from "@lingui/core/macro";
import type { EnqueueInput } from "../../downloads/DownloadQueueProvider";
import type { HubGameDownload } from "../api";

/**
 * Turn a hub game's ordered download sources into one download-queue request
 * (issue #2951). The queue tries the sources in the order the hub gave and
 * moves on to the next when one fails, so a repository with no release
 * archives sits below a rapid tag rather than instead of it, and a mirror
 * whose file does not match its hash is followed by the next mirror (issue
 * #5260). See `downloadHubGame` for how each kind is fetched.
 *
 * Nothing is looked up here: a source that cannot deliver is found out when
 * the queue reaches it, which is also when the player sees why.
 *
 * Throws when the hub named no source.
 */
export async function hubGameDownloadRequest(
  downloads: readonly HubGameDownload[],
  destDir: string,
  label: string,
  shortname?: string,
): Promise<EnqueueInput> {
  if (downloads.length === 0) {
    throw new Error(t`The hub named no download source for ${label}.`);
  }
  return {
    kind: "hubGame",
    label,
    args: { downloads: [...downloads], destDir, shortname },
  };
}
