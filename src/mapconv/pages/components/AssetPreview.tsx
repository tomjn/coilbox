import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { mcImageInfo } from "../../bindings";

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
    mcImageInfo({ path })
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
  if (!info) return null;
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
