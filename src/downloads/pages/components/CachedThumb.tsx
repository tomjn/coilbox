import type { ReactNode } from "react";
import { useCachedImage } from "@/content/branding";

/**
 * A remote artwork thumbnail served through the cached image proxy: the URL is
 * fetched once and re-served from the `coilbox-branding-images` disk cache on
 * repeat visits and offline. Renders `fallback` while the fetch is in flight, when
 * there is no URL, and when the fetch fails — so a slow CDN or offline start shows
 * a placeholder, never a broken `<img>`.
 *
 * `reencode` downsamples/JPEG-encodes decodable rasters to bound the cached data
 * URL (map minimaps are opaque, so the default is on); undecodable bytes (SVG or
 * WebP) pass through unchanged.
 */
export function CachedThumb({
  url,
  alt,
  className,
  fallback,
  reencode = true,
  loading = "lazy",
}: {
  url?: string;
  alt: string;
  className?: string;
  fallback: ReactNode;
  reencode?: boolean;
  loading?: "lazy" | "eager";
}) {
  const dataUrl = useCachedImage(url ? [url] : undefined, reencode);
  if (!dataUrl) return <>{fallback}</>;
  return (
    <img src={dataUrl} alt={alt} loading={loading} className={className} />
  );
}
