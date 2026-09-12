import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * The Windows portable update path.
 *
 * A portable install cannot use the NSIS installer the updater plugin runs on
 * Windows: NSIS reads its target folder out of the registry, so the update lands
 * on the machine's ordinary Coilbox install instead. See
 * `src-tauri/src/portable_update.rs` for why pointing NSIS at the portable folder
 * is not the answer either.
 *
 * Instead the release carries a plain zip of the same payload, and Coilbox
 * unpacks it over itself. Everything here is a thin wrapper over the Rust
 * commands that do that work.
 */

/**
 * The `latest.json` key holding the portable zip.
 *
 * Not one of Tauri's own target keys, so the updater plugin ignores it and
 * resolves `windows-x86_64` as usual. The release workflow adds it after the
 * bundler has written the manifest.
 */
export const PORTABLE_PLATFORM = "windows-x86_64-portable";

/** A `latest.json` platform entry. */
export interface PortableAsset {
  url: string;
  /** Base64 of the artifact's minisign `.sig`, checked in Rust before anything is unpacked. */
  signature: string;
}

/** Progress of the portable download, in the shape the shared indicator wants. */
export interface PortableProgress {
  downloaded: number;
  total: number | null;
}

/** Event the Rust download emits as bytes arrive. */
const PROGRESS_EVENT = "portable-update://progress";

/**
 * Whether this install must update itself rather than run the installer. True
 * only for a portable Windows install.
 */
export async function isPortableUpdate(): Promise<boolean> {
  return invoke<boolean>("portable_update_supported");
}

/**
 * The portable zip for this release, or null when the manifest has no such entry.
 *
 * A release built before the workflow started producing the zip has no entry, and
 * neither does a manifest served from somewhere else. Null is the signal to leave
 * the update alone rather than to guess a URL.
 */
export function portableAsset(
  rawJson: Record<string, unknown>,
): PortableAsset | null {
  const platforms = rawJson.platforms;
  if (typeof platforms !== "object" || platforms === null) return null;
  const entry = (platforms as Record<string, unknown>)[PORTABLE_PLATFORM];
  if (typeof entry !== "object" || entry === null) return null;
  const { url, signature } = entry as Record<string, unknown>;
  if (typeof url !== "string" || typeof signature !== "string") return null;
  if (!url || !signature) return null;
  return { url, signature };
}

/**
 * Download and check the zip, then unpack it into `.coilbox/update-staging`.
 * Installed files are untouched until {@link finishPortableUpdate}.
 */
export async function stagePortableUpdate(
  asset: PortableAsset,
  onProgress: (progress: PortableProgress) => void,
): Promise<void> {
  const stop = await listen<PortableProgress>(PROGRESS_EVENT, (e) =>
    onProgress(e.payload),
  );
  try {
    await invoke("portable_update_stage", {
      url: asset.url,
      signature: asset.signature,
    });
  } finally {
    stop();
  }
}

/**
 * Hand over to the staged build and quit.
 *
 * Does not resolve: the Rust side exits the process so the staged copy can
 * overwrite this one, then relaunches Coilbox itself. The caller gets no restart
 * prompt because there is nothing left to prompt from.
 */
export async function finishPortableUpdate(): Promise<void> {
  await invoke("portable_update_finish");
}
