import { useEffect, useState } from "react";
import { assetUrl, campaignMediaUrl, mediaKind } from "../lib/assetUrl";
import { campaignImageRead } from "./bindings";
import type { ImageRef } from "./model";

/**
 * Session cache of resolved panorama data URLs, keyed by `campaignId::file`.
 * Mirrors the branding image cache: a stored `file` panorama is read back off disk
 * once per session and shared across the preview and the export path.
 */
const panoramaCache = new Map<string, Promise<string>>();

/** Read a stored `file` panorama back as a `data:` URI (cache-backed). */
export function resolvePanoramaDataUri(
  campaignId: string,
  file: string,
): Promise<string> {
  const key = `${campaignId}::${file}`;
  let promise = panoramaCache.get(key);
  if (!promise) {
    promise = campaignImageRead({ campaignId, file }).then((r) => r.dataUrl);
    panoramaCache.set(key, promise);
  }
  return promise;
}

/**
 * Resolve a mission media ref to a displayable URL. Most kinds resolve synchronously:
 * `data` carries its URI inline; `local` maps to a `coilbox://` URL under the portable
 * root; and an audio/video `file` maps to the campaign's `coilbox://` media URL (never
 * a data URI — AV is range-served). Only an *image* `file` needs an async round-trip:
 * it's read off disk into a data URL and cached for the session. Returns `undefined`
 * while that read is in flight (or when there's no ref).
 */
export function useCampaignPanorama(
  campaignId: string,
  panorama?: ImageRef,
): string | undefined {
  // Synchronous URLs, decided from the ref kind + extension.
  const syncSrc =
    panorama?.kind === "data"
      ? panorama.dataUri
      : panorama?.kind === "local"
        ? assetUrl(panorama.path)
        : panorama?.kind === "file" && mediaKind(panorama.file) !== "image"
          ? campaignMediaUrl(campaignId, panorama.file)
          : undefined;
  // The one async case: an image stored as a `file` must be read into a data URL.
  const imageFile =
    panorama?.kind === "file" && mediaKind(panorama.file) === "image"
      ? panorama.file
      : undefined;
  const [src, setSrc] = useState<string | undefined>(syncSrc);

  useEffect(() => {
    if (syncSrc) {
      setSrc(syncSrc);
      return;
    }
    if (!imageFile) {
      setSrc(undefined);
      return;
    }
    let cancelled = false;
    resolvePanoramaDataUri(campaignId, imageFile)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        // A failed read shouldn't stick forever — drop it so a later render retries.
        panoramaCache.delete(`${campaignId}::${imageFile}`);
        if (!cancelled) setSrc(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, imageFile, syncSrc]);

  return src;
}

/**
 * The resolver is image-kind-agnostic (it just reads a stored `file` back or uses
 * an inline `data` URI), so these aliases let icon/background/side-graphic code
 * read naturally without a panorama-flavoured name.
 */
export const useCampaignImage = useCampaignPanorama;
export const resolveImageDataUri = resolvePanoramaDataUri;
