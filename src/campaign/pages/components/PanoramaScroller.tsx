import { cn } from "@picoframe/frame";
import type { SyntheticEvent } from "react";
import { useRef, useState } from "react";
import type { PanoramaRef } from "../../model";
import { useCampaignPanorama } from "../../panorama";

/** Constant scroll speed; the per-image duration is derived to hold this. */
const SCROLL_SPEED_PX_PER_SEC = 25;

/**
 * A seamlessly-looping horizontal scroll of a mission briefing panorama. The track
 * holds two copies of the image and translates from `translateX(0)` to
 * `translateX(-50%)` — exactly one image width — so when the animation restarts the
 * second copy sits where the first began: a mathematically seamless wrap (it only
 * *looks* seamless if the art tiles horizontally). The loop duration is derived
 * from the image's natural width so the speed stays constant regardless of image
 * size; `prefers-reduced-motion` disables the motion (see index.css).
 */
export function PanoramaScroller({
  campaignId,
  panorama,
  className,
}: {
  campaignId: string;
  panorama: PanoramaRef;
  className?: string;
}) {
  const src = useCampaignPanorama(campaignId, panorama);
  const trackRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // One image-width of travel takes (naturalWidth / speed) seconds, so wider art
  // scrolls for longer at the same px/s. Set as a CSS var the keyframes read.
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const width = e.currentTarget.naturalWidth || e.currentTarget.width;
    const seconds = Math.max(1, width / SCROLL_SPEED_PX_PER_SEC);
    trackRef.current?.style.setProperty("--panorama-duration", `${seconds}s`);
    setReady(true);
  };

  if (!src) {
    return (
      <div
        className={cn("h-28 animate-pulse rounded-md bg-muted", className)}
      />
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-md bg-muted", className)}>
      <div
        ref={trackRef}
        className={cn("flex h-28 w-max", ready && "campaign-panorama-track")}
      >
        <img
          src={src}
          alt="Mission panorama"
          className="h-full w-auto max-w-none"
          onLoad={onLoad}
        />
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="h-full w-auto max-w-none"
        />
      </div>
    </div>
  );
}
