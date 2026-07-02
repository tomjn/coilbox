import { X } from "lucide-react";
import { useState } from "react";
import type { BrandingScreenshot } from "../../branding";
import { useBrandingImage } from "../../branding";

/** One thumbnail resolved via the image proxy; click opens the lightbox. */
function Thumb({
  shot,
  onOpen,
}: {
  shot: BrandingScreenshot;
  onOpen: (dataUrl: string, caption?: string) => void;
}) {
  const dataUrl = useBrandingImage(shot.urls);
  if (!dataUrl) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(dataUrl, shot.caption)}
      className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-md border border-border/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <img
        src={dataUrl}
        alt={shot.caption ?? ""}
        className="size-full object-cover"
      />
    </button>
  );
}

/**
 * A horizontal strip of branding screenshots with a click-to-open lightbox. Each
 * thumbnail resolves through the same cached image proxy as banners/logos.
 */
export function BrandingScreenshots({
  shots,
}: {
  shots: BrandingScreenshot[];
}) {
  const [open, setOpen] = useState<{ url: string; caption?: string } | null>(
    null,
  );
  if (shots.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Screenshots</h2>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {shots.map((s, i) => (
          <Thumb
            key={s.urls[0] ?? i}
            shot={s}
            onOpen={(url, caption) => setOpen({ url, caption })}
          />
        ))}
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-8"
          onClick={() => setOpen(null)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(null)}
          role="dialog"
          aria-modal="true"
          aria-label={open.caption ?? "Screenshot"}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setOpen(null)}
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
          <img
            src={open.url}
            alt={open.caption ?? ""}
            className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
          />
          {open.caption && (
            <p className="text-sm text-white/90">{open.caption}</p>
          )}
        </div>
      )}
    </section>
  );
}
