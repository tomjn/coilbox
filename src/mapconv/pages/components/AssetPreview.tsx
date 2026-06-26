import { ImageOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getImageInfo } from "../../imageCache";

/**
 * Thumbnail + true pixel dimensions for a chosen image asset. Decodes via the
 * `mc_image_info` command (which downscales server-side, so a huge texture
 * doesn't get embedded whole). Reports the dimensions up via `onInfo` so a
 * parent can validate sizing without a second decode.
 */
export function AssetPreview({
  path,
  onInfo,
}: {
  path: string;
  onInfo?: (info: { width: number; height: number }) => void;
}) {
  const [info, setInfo] = useState<{
    thumb: string;
    width: number;
    height: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on path only; onInfo is a reporting callback, not an input
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setFailed(false);
    if (!path) return;
    getImageInfo(path)
      .then((r) => {
        if (cancelled) return;
        setInfo(r);
        onInfo?.({ width: r.width, height: r.height });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageOff size={13} /> No preview available.
      </p>
    );
  }
  if (!info) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-border bg-muted/30">
          <Loader2
            size={16}
            className="animate-spin text-muted-foreground/50"
          />
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          generating preview…
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <img
        src={info.thumb}
        alt="Selected asset preview"
        className="h-16 w-16 shrink-0 rounded border border-border bg-muted/30 object-contain"
      />
      <span className="font-mono text-xs text-muted-foreground">
        {info.width} × {info.height}px
      </span>
    </div>
  );
}
