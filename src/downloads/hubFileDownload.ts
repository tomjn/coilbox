import { t } from "@lingui/core/macro";
import type { HubFileDownload } from "../hub/api";
import { dlDownloadFileRaw } from "./bindings";
import { hostOf } from "./downloadHistory";
import { loadGithubReleases } from "./githubReleases";
import { checkHubDownload } from "./hubMismatch";
import { type ProgressSink, progressChannel } from "./progressChannel";
import type { AttemptLog } from "./sourceWalk";

/**
 * Fetch one of the hub's file sources into `destDir`: begins an attempt in
 * `log`, throws when it fails, and leaves ending the attempt to the caller.
 * Shared by hub games and hub maps, which differ in what they walk and not in
 * how a source is fetched.
 *
 * `url` is fetched directly and checked against its `sha256` when it has one.
 * `github` has its release archives looked up first: a repository with none, or
 * with none matching `asset`, fails that source rather than installing some other
 * release (issue #2859).
 */
export async function fetchHubFile(
  dl: HubFileDownload,
  o: {
    destDir: string;
    opId?: string;
    onProgress: ProgressSink;
    log: AttemptLog;
  },
): Promise<void> {
  const fetchFile = (
    url: string,
    filename: string,
    sha256: string | undefined,
  ) =>
    dlDownloadFileRaw({
      url,
      destDir: o.destDir,
      filename,
      sha256,
      opId: o.opId,
      onProgress: progressChannel(o.onProgress),
    });

  if (dl.kind === "url") {
    const host = hostOf(dl.value);
    o.log.begin(
      "url",
      { reference: dl.value, filename: dl.filename, mirror: host },
      { label: host ?? dl.value },
    );
    if (!dl.filename) throw new Error(t`no filename to save it as`);
    await fetchFile(dl.value, dl.filename, dl.sha256);
    // The file has the hash the hub listed. Whether it is the archive the hub
    // says it is gets checked in the background and never holds up the download.
    if (dl.sha256) {
      void checkHubDownload({
        sha256: dl.sha256,
        destDir: o.destDir,
        filename: dl.filename,
      });
    }
    return;
  }

  o.log.begin("github", { reference: dl.value }, { label: dl.value });
  const archives = await loadGithubReleases(dl.value);
  if (archives.length === 0) throw new Error(t`no release archives`);
  const asset = dl.asset?.toLowerCase();
  const pick = asset
    ? archives.find((a) => a.filename.toLowerCase().includes(asset))
    : archives[0];
  if (!pick) {
    const count = archives.length;
    const wanted = dl.asset ?? "";
    throw new Error(
      t`no release matching "${wanted}" in its latest ${count} release(s)`,
    );
  }
  o.log.begin(
    "github",
    {
      reference: pick.tag,
      filename: pick.filename,
      mirror: hostOf(pick.url),
    },
    { label: dl.value },
  );
  await fetchFile(pick.url, pick.filename, undefined);
}
