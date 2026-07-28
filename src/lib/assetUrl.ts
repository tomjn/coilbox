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

/** URL for a file in the unit builder's parts pack, under `legopack/<file>`. */
export function legoPackUrl(file: string): string {
  return schemeUrl("legopack", file);
}

/** URL for a saved unit's overview thumbnail. */
export function legoThumbUrl(projectId: string): string {
  return schemeUrl("lego", `${projectId}.png`);
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
