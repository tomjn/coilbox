import type { Channel } from "@tauri-apps/api/core";
import { contentRescan } from "../content/bindings";
import {
  type DownloadProgress,
  dlDownloadEngineRecoil,
  dlRecoilEngines,
  type EngineRelease,
} from "./bindings";

/** The newest Recoil release for this platform, or null when none is available
 * (e.g. macOS). `releases` is newest-first from the backend. */
export async function fetchNewestRecoil(): Promise<{
  release: EngineRelease | null;
  platform: string;
}> {
  const { releases, platform } = await dlRecoilEngines(undefined);
  return { release: releases[0] ?? null, platform };
}

/** Download + install a Recoil release into `writePath`, then rescan content so
 * the engine is picked up. Throws on download failure. Returns the sidecar's message. */
export async function installRecoil(
  release: EngineRelease,
  writePath: string,
  onProgress: Channel<DownloadProgress>,
): Promise<string> {
  const { message } = await dlDownloadEngineRecoil({
    version: release.version,
    assetUrl: release.assetUrl,
    writePath,
    onProgress,
  });
  try {
    await contentRescan(undefined);
  } catch {
    // non-fatal: engine is installed; the list just won't auto-refresh
  }
  return message;
}
