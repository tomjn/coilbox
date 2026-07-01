import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** Download progress for the settings-section progress bar. */
export type DownloadPhase =
  | { status: "idle" }
  | { status: "downloading"; downloaded: number; total?: number }
  | { status: "installed" };

/** Check GitHub for a newer release. Resolves null when up to date. */
export async function checkForUpdate(): Promise<Update | null> {
  return check();
}

/** The running app's version (from tauri.conf.json, injected from the git tag in CI). */
export async function currentVersion(): Promise<string> {
  return getVersion();
}

/**
 * Download + install an update, reporting progress. Accumulates chunk lengths
 * from the Tauri download events into a running byte count.
 */
export async function installUpdate(
  update: Update,
  onProgress: (phase: DownloadPhase) => void,
): Promise<void> {
  let total: number | undefined;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength;
        onProgress({ status: "downloading", downloaded: 0, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({ status: "downloading", downloaded, total });
        break;
      case "Finished":
        onProgress({ status: "installed" });
        break;
    }
  });
}

export type { Update };
export { relaunch };
