import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
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
 *
 * Download and install are two calls rather than `downloadAndInstall` so
 * `prepare_for_update` can run between them. On Windows the installer is started
 * as our child process and we exit immediately after, which killed it while our
 * Job Object was still confining new children (issue #1691). The command lifts
 * that for the installer only, and the narrow gap here keeps every sidecar
 * spawned before it inside the job, so their .exe files still come unlocked.
 */
export async function installUpdate(
  update: Update,
  onProgress: (phase: DownloadPhase) => void,
): Promise<void> {
  let total: number | undefined;
  let downloaded = 0;
  await update.download((event) => {
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
  await invoke("prepare_for_update");
  await update.install();
}

export type { Update };
export { relaunch };
