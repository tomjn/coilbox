import { cn } from "@picoframe/frame";
import { Map as MapIcon } from "lucide-react";

/**
 * A minimap thumbnail. unitsync minimaps are always square (the map sampled into
 * a square texture), so we set the image's aspect ratio to the map's real
 * proportions and let `object-fill` stretch the square source back to true shape
 * — undistorted — letterboxed inside a uniform square box.
 */
export function MapThumb({
  dataUrl,
  width,
  height,
  alt,
  loading,
}: {
  dataUrl?: string;
  width?: number;
  height?: number;
  alt: string;
  loading?: boolean;
}) {
  // Fill the constraining dimension so the minimap is as large as it can be —
  // touching two edges (never floating with a border all round); the other axis
  // letterboxes only when the map is non-square.
  const wide = (width ?? 1) >= (height ?? 1);
  return (
    <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted">
      {loading ? (
        <div className="size-full animate-pulse bg-muted-foreground/10" />
      ) : dataUrl ? (
        <img
          src={dataUrl}
          alt={alt}
          loading="lazy"
          style={
            width && height
              ? { aspectRatio: `${width} / ${height}` }
              : undefined
          }
          className={cn(
            "object-fill",
            width && height
              ? wide
                ? "h-auto w-full"
                : "h-full w-auto"
              : "size-full",
          )}
        />
      ) : (
        <MapIcon className="size-7 text-muted-foreground/40" />
      )}
    </div>
  );
}

/** Friendly Spring map size (metal-infomap dims are 32× the map-size units). */
export function mapSizeLabel(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  return `${Math.round(width / 32)} × ${Math.round(height / 32)}`;
}
