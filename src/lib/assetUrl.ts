/**
 * Frontend glue for the `coilbox://` asset protocol (see
 * `src-tauri/src/asset_protocol.rs`). Builds the platform-correct scheme URL for a
 * local media file so the webview can load it natively — no base64 `data:` URI, and
 * with HTTP range support so `<video>`/`<audio>` can seek.
 *
 * The scheme is multi-root: the first path segment picks the root (`portable` for
 * the `.coilbox` folder, `campaign` for per-campaign app-data media), the rest is the
 * file path. On macOS/Linux the URL is `coilbox://localhost/<path>`; on Windows the
 * runtime rewrites custom schemes to `http://coilbox.localhost/<path>`, so we emit
 * that form there. Keeping the root selector in the *path* (not the host) means it
 * survives that rewrite unchanged.
 */

import type { ImageRef } from "../campaign/model";

/**
 * Windows serves custom schemes from `http://<scheme>.localhost/…` rather than
 * `<scheme>://localhost/…`. There's no `@tauri-apps/plugin-os` dependency here, so
 * detect it from the WebView2 user-agent (which always contains "Windows").
 */
function isWindows(): boolean {
  return /windows/i.test(navigator.userAgent);
}

/** Build a `coilbox://` URL for `<root>/<rel>`, encoding each segment but keeping `/`. */
function schemeUrl(root: string, rel: string): string {
  const path = [root, ...rel.replace(/^\.?\//, "").split("/")]
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return isWindows()
    ? `http://coilbox.localhost/${path}`
    : `coilbox://localhost/${path}`;
}

/** URL for a file under the portable `.coilbox/` folder (profile + bundled campaigns). */
export function assetUrl(rel: string): string {
  return schemeUrl("portable", rel);
}

/** URL for a user-authored campaign's imported AV, under `campaign/<id>/<file>`. */
export function campaignMediaUrl(campaignId: string, file: string): string {
  return schemeUrl("campaign", `${campaignId}/${file}`);
}

/**
 * URL for one of a scenario's dialogue clips, under `scenario/<id>/<file>`. The
 * scenario editor shows a portrait and plays a voice clip through this rather
 * than through the plugin's `data:` URL command, which would hold the whole file
 * base64 in memory and cannot seek (issue #785). The plugin still reads a clip as
 * a data URL for export, where the bytes have to be inlined anyway.
 */
export function scenarioMediaUrl(scenarioId: string, file: string): string {
  return schemeUrl("scenario", `${scenarioId}/${file}`);
}

/** URL for a file in the unit builder's base parts pack, under `legopack/<file>`. */
export function legoPackUrl(file: string): string {
  return schemeUrl("legopack", file);
}

/**
 * URL for a file in an installed extension parts pack, under
 * `legopacks/<pack>/<file>`. `pack` is the pack's folder name, which is what
 * `legoPacks` lists.
 */
export function legoExtraPackUrl(pack: string, file: string): string {
  return schemeUrl("legopacks", `${pack}/${file}`);
}

/**
 * URL for a texture the unit-model viewer copied out of a game archive, under
 * `unitmodel/<file>`. Raw archive bytes rather than anything decoded: a game's
 * shared unit atlas can be a 64 MiB compressed DDS, which the webview uploads
 * still compressed.
 */
export function unitModelTextureUrl(file: string): string {
  return schemeUrl("unitmodel", file);
}

/**
 * URL for a rendered minimap, heightmap or metalmap the unitsync worker cached,
 * under `unitsyncthumb/<file>`. The worker hands back the cache file name rather
 * than the PNG so a full-resolution minimap does not cross the bridge as base64,
 * and the name is content-keyed so the webview may cache it indefinitely.
 */
export function unitsyncThumbUrl(file: string): string {
  return schemeUrl("unitsyncthumb", file);
}

/** URL for a game's cached loading-screen art, under `unitsyncheader/<file>`. */
export function unitsyncHeaderUrl(file: string): string {
  return schemeUrl("unitsyncheader", file);
}

/**
 * URL for a unit's cached build icon, under `unitsyncbuildpic/<file>`. A game's
 * roster runs to several hundred, and a build tree draws them all at once, so
 * the worker names the cache file rather than inlining each icon as base64.
 */
export function unitsyncBuildpicUrl(file: string): string {
  return schemeUrl("unitsyncbuildpic", file);
}

/** URL for a side's cached faction emblem, under `unitsyncfactionlogo/<file>`. */
export function unitsyncFactionLogoUrl(file: string): string {
  return schemeUrl("unitsyncfactionlogo", file);
}

/**
 * URL for a downscaled preview of a map author's source image, under
 * `mapconvthumb/<file>`. The 3D preview asks for a large heightmap, which is
 * megabytes of PNG, so the cache file is named rather than inlined.
 */
export function mapconvThumbUrl(file: string): string {
  return schemeUrl("mapconvthumb", file);
}

/**
 * URL for a game's cached catalog art, under `contentbranding/<file>`. A banner
 * is re-encoded to fit 1920x1080, which is a few hundred kilobytes, and the
 * games list shows several at once.
 */
export function contentBrandingUrl(file: string): string {
  return schemeUrl("contentbranding", file);
}

/** URL for a saved unit's overview thumbnail. */
export function legoThumbUrl(projectId: string): string {
  return schemeUrl("lego", `${projectId}.png`);
}

/**
 * URL for the meshes of a unit imported from somebody else's `.s3o`, under
 * `legogeom/<projectId>.bin.gz`. Gzipped, and inflated with fflate the same way
 * the parts pack's blob is.
 */
export function legoGeometryUrl(projectId: string): string {
  return schemeUrl("legogeom", `${projectId}.bin.gz`);
}

/**
 * URL for a texture in the unit builder's shared store, under `legotex/<key>`.
 *
 * The key is the texture's content hash, which is what makes refreshing an
 * edited file work: new bytes are a new key and therefore a new URL, so there
 * is nothing stale behind the old one for the webview to serve.
 */
export function legoTextureUrl(key: string): string {
  return schemeUrl("legotex", key);
}

/**
 * Whether a URL string is a local reference to be rewritten to the asset protocol
 * (as opposed to an absolute URL, data/blob URI, in-page anchor, or already-app-
 * absolute `/…` path). Used by the profile welcome HTML/CSS rewrite.
 */
export function isLocalRef(url: string): boolean {
  return !/^(https?:|data:|blob:|coilbox:|#|mailto:|tel:|\/)/i.test(url.trim());
}

/**
 * Media file extensions — the single source of truth for both file-dialog filters
 * and {@link mediaKind} classification (previously duplicated across the campaign
 * components). Anything not audio/video is treated as an image.
 */
export const AUDIO_EXTS = ["ogg", "oga", "mp3", "wav", "flac", "opus", "m4a"];
export const VIDEO_EXTS = ["mp4", "webm", "mov", "ogv"];
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "bmp"];

/** The extension of a path/URL, lowercased and without query/hash, or "". */
function extOf(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

/** Classify a media reference by extension so callers render the right element. */
export type MediaKind = "audio" | "video" | "image";
export function mediaKind(path: string): MediaKind {
  const ext = extOf(path);
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (VIDEO_EXTS.includes(ext)) return "video";
  return "image";
}

/**
 * Whether a stored media ref points at a video, so the editor can show video-only
 * playback toggles and renderers pick `<video>`. A `data` ref is always an image
 * (AV is never inlined); `file`/`local` are classified by extension.
 */
export function refIsVideo(ref: ImageRef | undefined): boolean {
  if (!ref) return false;
  if (ref.kind === "file") return mediaKind(ref.file) === "video";
  if (ref.kind === "local") return mediaKind(ref.path) === "video";
  return false;
}
