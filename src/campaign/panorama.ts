import { useEffect, useState } from "react";
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
 * Resolve a mission panorama to a displayable `data:` URL. `data` panoramas (from
 * an exported campaign) carry their URI inline; `file` panoramas are read off disk
 * via the plugin and cached for the session. Returns `undefined` while a file read
 * is in flight (or when there's no panorama).
 */
export function useCampaignPanorama(
  campaignId: string,
  panorama?: ImageRef,
): string | undefined {
  const dataUri = panorama?.kind === "data" ? panorama.dataUri : undefined;
  const file = panorama?.kind === "file" ? panorama.file : undefined;
  const [src, setSrc] = useState<string | undefined>(dataUri);

  useEffect(() => {
    if (dataUri) {
      setSrc(dataUri);
      return;
    }
    if (!file) {
      setSrc(undefined);
      return;
    }
    let cancelled = false;
    resolvePanoramaDataUri(campaignId, file)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        // A failed read shouldn't stick forever — drop it so a later render retries.
        panoramaCache.delete(`${campaignId}::${file}`);
        if (!cancelled) setSrc(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, file, dataUri]);

  return src;
}

/**
 * The resolver is image-kind-agnostic (it just reads a stored `file` back or uses
 * an inline `data` URI), so these aliases let icon/background/side-graphic code
 * read naturally without a panorama-flavoured name.
 */
export const useCampaignImage = useCampaignPanorama;
export const resolveImageDataUri = resolvePanoramaDataUri;
