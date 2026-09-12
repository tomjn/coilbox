import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  finishPortableUpdate,
  isPortableUpdate,
  portableAsset,
  stagePortableUpdate,
} from "./portableUpdate";

/** How far an update has got, for whatever is drawing it. */
export type DownloadPhase =
  | { status: "idle" }
  | { status: "downloading"; downloaded: number; total?: number }
  /**
   * The transfer is done and the installer is next. Distinct from downloading
   * because nothing is coming down the wire any more, and the topbar download
   * indicator should stop claiming otherwise.
   */
  | { status: "installing" };

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
  if (await isPortableUpdate()) {
    await installPortable(update, onProgress);
    return;
  }

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
        onProgress({ status: "installing" });
        break;
    }
  });
  await invoke("prepare_for_update");
  await update.install();
}

/**
 * The same job for a portable Windows install, which cannot run the NSIS
 * installer without writing over the machine's ordinary Coilbox (see
 * `portableUpdate.ts`).
 *
 * Coilbox fetches a signed zip of the payload, unpacks it to a staging folder and
 * hands over to the staged build, which copies itself into place once we have
 * exited. `prepare_for_update` is not called: the swap process is deliberately
 * started outside the job object, and the sidecars need to stay in it so the
 * kernel closes them, and their file locks, when we go.
 *
 * A release with no portable zip in its manifest is refused rather than installed
 * the wrong way. That covers any release built before the workflow started
 * producing one.
 */
async function installPortable(
  update: Update,
  onProgress: (phase: DownloadPhase) => void,
): Promise<void> {
  const asset = portableAsset(update.rawJson);
  if (!asset) {
    throw new Error(
      `Coilbox ${update.version} has no portable download, so it cannot be installed over this copy. Update the package instead.`,
    );
  }

  await stagePortableUpdate(asset, ({ downloaded, total }) =>
    onProgress({
      status: "downloading",
      downloaded,
      total: total ?? undefined,
    }),
  );
  onProgress({ status: "installing" });
  await finishPortableUpdate();
}

export type { Update };
export { relaunch };
