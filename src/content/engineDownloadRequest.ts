import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import { fetchNewestRecoil } from "../downloads/engineInstall";

/**
 * The download-queue request for the newest engine release, or null when there
 * is no release for this platform. The queue's engineRecoil kind rescans content
 * after the install.
 */
export async function engineDownloadRequest(
  writePath: string,
  label: (version: string) => string,
): Promise<EnqueueInput | null> {
  const { release } = await fetchNewestRecoil();
  if (!release) return null;
  return {
    kind: "engineRecoil",
    label: label(release.version),
    args: {
      version: release.version,
      assetUrl: release.assetUrl,
      writePath,
    },
  };
}
