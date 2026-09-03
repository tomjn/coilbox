import { cn } from "@picoframe/frame";
import { useEffect, useRef } from "react";
import { useEffectsEnabled, useReduceMotion } from "../../../general/display";
import { mediaKind } from "../../../lib/assetUrl";
import type { ImageRef, MediaPlayback } from "../../model";
import { useCampaignImage } from "../../panorama";
import {
  CampaignVideo,
  DECORATIVE_DEFAULTS,
  resolvePlayback,
} from "./MediaPlayer";

/** Constant scroll speed; the per-image duration is derived to hold this. */
const SCROLL_SPEED_PX_PER_SEC = 25;

/**
 * How many copies of the art may show at once. One or two reads as a picture. Beyond
 * that the repetition itself becomes the subject, and the backdrop starts competing
 * with the text in front of it.
 */
const MAX_REPEATS = 2;

/**
 * The width to draw one copy of the art at.
 *
 * The natural width is the one that shows the whole picture, the art scaled to the
 * element's height. That is what we want whenever it is big enough, but a short band
 * (the 80px mission card strip) or art that is tall for its width leaves a natural
 * tile far narrower than the element, and the art then repeats across it as a
 * pattern. Above {@link MAX_REPEATS} copies we scale the art up instead, so it is
 * cropped top and bottom the way `background-size: cover` crops the still backdrop.
 * Fewer, larger copies of the art, at the cost of its edges.
 *
 * Returns 0 when there is nothing to measure yet, which leaves the CSS fallback in
 * place.
 */
export function panoramaTileWidth(
  /** Source image aspect ratio, width over height. */
  ratio: number,
  /** Rendered element width in px. */
  width: number,
  /** Rendered element height in px. */
  height: number,
): number {
  const natural = height * ratio;
  if (!(natural > 0)) return 0;
  if (!(width > 0)) return natural;
  return Math.max(natural, width / MAX_REPEATS);
}

/**
 * A seamlessly-looping horizontal scroll of a mission briefing panorama. The art is
 * tiled across the element with `background-repeat: repeat-x`, aspect-preserved and
 * never shorter than the element, so it always fills the width however narrow the
 * source is, and the background scrolls by exactly one tile width per loop for a
 * seamless wrap.
 *
 * This replaces an earlier two-copy flex track that only worked for art at least as
 * wide as the container: a narrow/tiling source left the solid backdrop showing
 * through. The tile width (and thus loop distance + duration) comes from
 * {@link panoramaTileWidth}, so the speed stays constant regardless of image size,
 * and `prefers-reduced-motion` disables the motion (see index.css).
 *
 * An image panorama can also be held *static* (full-bleed `background-size: cover`)
 * via `playback.scroll === false`; a video panorama delegates to
 * {@link CampaignVideo} for its autoplay/loop/muted config and control overlay.
 */
export function PanoramaScroller({
  campaignId,
  panorama,
  playback,
  className,
  fill = false,
}: {
  campaignId: string;
  panorama: ImageRef;
  /** Playback config: `scroll` for images, autoplay/loop/muted for video. */
  playback?: MediaPlayback;
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
  const scroll = resolvePlayback(playback, DECORATIVE_DEFAULTS).scroll;
  // Settings-aware stillness: dropping the animation class leaves the first
  // tile as a static backdrop. The CSS media query still covers the OS
  // preference on its own (see index.css); this adds the app-level toggles
  // on top of the author's `playback.scroll` choice.
  const reduceMotion = useReduceMotion();
  const effectsEnabled = useEffectsEnabled();
  const still = reduceMotion || !effectsEnabled;

  // Measure the tile width (image aspect × rendered height) and set the loop
  // distance + duration as custom properties the keyframes read. Re-measures on
  // resize so a responsive full-bleed background stays seamless.
  useEffect(() => {
    const el = ref.current;
    // Only the scrolling image branch needs measurement: a video fills via
    // object-cover, and a static image uses background-size: cover.
    if (!el || !src || isVideo || !scroll) return;
    let ratio = 0;
    const apply = () => {
      if (!ratio) return;
      const tile = panoramaTileWidth(ratio, el.clientWidth, el.clientHeight);
      if (tile <= 0) return;
      el.style.setProperty("--panorama-tile", `${tile}px`);
      el.style.setProperty("--panorama-size", `${tile}px auto`);
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
  }, [src, isVideo, scroll]);

  if (!src) {
    return (
      <div
        className={cn("animate-pulse rounded-md bg-muted", height, className)}
      />
    );
  }

  // A video backdrop loops muted by default (audio belongs in the voiceover slot)
  // but its playback and the control overlay come from CampaignVideo.
  if (isVideo) {
    return (
      <CampaignVideo
        src={src}
        playback={playback}
        defaults={DECORATIVE_DEFAULTS}
        variant="background"
        label="Briefing backdrop"
        className={cn("rounded-md bg-muted", height, className)}
      />
    );
  }

  // A static image backdrop: full-bleed, centered, no scroll.
  if (!scroll) {
    return (
      <div
        aria-hidden
        className={cn(
          "rounded-md bg-muted bg-cover bg-center",
          height,
          className,
        )}
        style={{ backgroundImage: `url("${src}")` }}
      />
    );
  }

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "campaign-panorama overflow-hidden rounded-md bg-muted",
        still && "campaign-panorama-still",
        height,
        className,
      )}
      style={{ backgroundImage: `url("${src}")` }}
    />
  );
}
