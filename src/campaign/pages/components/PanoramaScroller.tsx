import { cn } from "@picoframe/frame";
import { useEffect, useRef } from "react";
import { mediaKind } from "../../../lib/assetUrl";
import type { ImageRef } from "../../model";
import { useCampaignImage } from "../../panorama";

/** Constant scroll speed; the per-image duration is derived to hold this. */
const SCROLL_SPEED_PX_PER_SEC = 25;

/**
 * A seamlessly-looping horizontal scroll of a mission briefing panorama. The art is
 * tiled across the element with `background-repeat: repeat-x` (at full element
 * height, aspect-preserved) so it always fills the width — no matter how narrow the
 * source — and the background scrolls by exactly one tile width per loop for a
 * seamless wrap.
 *
 * This replaces an earlier two-copy flex track that only worked for art at least as
 * wide as the container: a narrow/tiling source left the solid backdrop showing
 * through. The tile width (and thus loop distance + duration) is measured from the
 * image's aspect ratio and the element's rendered height, so the speed stays
 * constant regardless of image size; `prefers-reduced-motion` disables the motion
 * (see index.css).
 */
export function PanoramaScroller({
  campaignId,
  panorama,
  className,
  fill = false,
}: {
  campaignId: string;
  panorama: ImageRef;
  className?: string;
  /**
   * Stretch to fill the container (`h-full`) instead of the default fixed band —
   * used by the mission briefing where the panorama is the full-bleed page
   * background. The builder previews keep the compact band.
   */
  fill?: boolean;
}) {
  const src = useCampaignImage(campaignId, panorama);
  const isVideo = src ? mediaKind(src) === "video" : false;
  const ref = useRef<HTMLDivElement>(null);
  const height = fill ? "h-full" : "h-28";

  // Measure the tile width (image aspect × rendered height) and set the loop
  // distance + duration as custom properties the keyframes read. Re-measures on
  // resize so a responsive full-bleed background stays seamless.
  useEffect(() => {
    const el = ref.current;
    // A video backdrop (below) fills via object-cover — no tile measurement needed.
    if (!el || !src || isVideo) return;
    let ratio = 0;
    const apply = () => {
      if (!ratio) return;
      const tile = el.clientHeight * ratio;
      if (tile <= 0) return;
      el.style.setProperty("--panorama-tile", `${tile}px`);
      el.style.setProperty(
        "--panorama-duration",
        `${Math.max(1, tile / SCROLL_SPEED_PX_PER_SEC)}s`,
      );
    };
    const img = new window.Image();
    img.onload = () => {
      ratio = img.naturalWidth / img.naturalHeight;
      apply();
    };
    img.src = src;
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [src, isVideo]);

  if (!src) {
    return (
      <div
        className={cn("animate-pulse rounded-md bg-muted", height, className)}
      />
    );
  }

  // A video backdrop autoplays muted and loops as a silent background clip (audio
  // belongs in the mission voiceover slot). `object-cover` fills the band the same
  // way the tiled image background does.
  if (isVideo) {
    return (
      <video
        aria-hidden
        src={src}
        autoPlay
        loop
        muted
        playsInline
        className={cn(
          "w-full rounded-md bg-muted object-cover",
          height,
          className,
        )}
      />
    );
  }

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "campaign-panorama overflow-hidden rounded-md bg-muted",
        height,
        className,
      )}
      style={{ backgroundImage: `url("${src}")` }}
    />
  );
}
