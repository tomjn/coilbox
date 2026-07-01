import { ImageOff } from "lucide-react";
import type { StartPos } from "@/content/bindings";

/**
 * Responsive height cap for the minimap (`--mmh`), stepping up with screen size so
 * the preview stays modest on small screens and grows on large ones. Used to cap
 * the rendered size while preserving aspect ratio (see the width calc below).
 */
const MAX_HEIGHT_CLASSES =
  "[--mmh:13rem] sm:[--mmh:15rem] lg:[--mmh:19rem] xl:[--mmh:23rem]";

/**
 * A map's minimap with team-coloured start-position markers overlaid. Start
 * positions are world coords; the map's world size is its metal-map dimension
 * * 16, so we normalise to 0..1 over the aspect-correct (object-fill) image.
 * Extracted from the content Map detail so the launcher and browser share it.
 */
export function MinimapPreview({
  dataUrl,
  width,
  height,
  startPositions,
  markerColors,
  loading,
  alt,
  onClick,
}: {
  dataUrl?: string | null;
  width?: number;
  height?: number;
  startPositions: StartPos[];
  /** CSS colours for each start marker, by index; falls back to white. */
  markerColors?: string[];
  loading?: boolean;
  alt: string;
  /** When set, the preview is clickable (used to open the map picker). */
  onClick?: () => void;
}) {
  const worldW = (width ?? 0) * 16;
  const worldH = (height ?? 0) * 16;
  const ratio = width && height ? width / height : 1;
  const markers =
    worldW > 0 && worldH > 0
      ? startPositions.map((p, i) => ({
          key: `${p.x},${p.z},${i}`,
          left: (p.x / worldW) * 100,
          top: (p.z / worldH) * 100,
          color: markerColors?.[i] ?? "#ffffff",
        }))
      : [];

  // The minimap image is width-bounded and keeps the map's real aspect ratio via
  // `aspectRatio` + `object-fill` (unitsync samples the map into a square texture,
  // which we stretch back to the true proportions). Loading/empty states show a
  // square placeholder so the card doesn't collapse.
  const base = `relative flex w-full items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-card ${MAX_HEIGHT_CLASSES}`;
  const body = loading ? (
    <div className="flex aspect-square w-full items-center justify-center">
      <div className="size-32 animate-pulse rounded bg-muted" />
    </div>
  ) : dataUrl ? (
    // Bound the size to the responsive max-height (`--mmh`) while preserving the
    // aspect ratio: width = min(100%, ratio * maxHeight), height derived. This caps
    // height without a height-clamp that would distort the (stretched) image.
    <div
      className="relative"
      style={{
        aspectRatio: `${ratio}`,
        width: `min(100%, calc(${ratio} * var(--mmh)))`,
      }}
    >
      <img
        src={dataUrl}
        alt={alt}
        className="absolute inset-0 size-full object-fill"
      />
      {markers.map((m, i) => (
        <span
          key={m.key}
          className="absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-black/60 text-[9px] font-bold text-black shadow"
          style={{
            left: `${m.left}%`,
            top: `${m.top}%`,
            background: m.color,
          }}
          title={`Start position ${i + 1}`}
        >
          {i + 1}
        </span>
      ))}
    </div>
  ) : (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 text-muted-foreground">
      <ImageOff className="size-6" />
      <span className="text-xs">No minimap</span>
    </div>
  );

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={alt}
      className={`${base} cursor-pointer transition-colors hover:border-primary`}
    >
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  );
}
