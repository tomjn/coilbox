import { t } from "@lingui/core/macro";
import { cn } from "@picoframe/frame";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import {
  BracketFrame,
  HUD_DIM_INK_CLASS,
  HUD_INK_CLASS,
} from "../pages/components/hudChrome";

/** How long the loading screen takes to fade into the map. */
export const MAP_LOADING_FADE_MS = 600;

/** Pixels for {@link MapLoading}'s flat picture of the land. */
export interface ReliefPicture {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/**
 * Fills the strategic view's place while its map is not ready to draw: the
 * stages already done, the one under way and how far through it is, over a
 * flat picture of the land once there is one.
 */
export function MapLoading({
  label,
  done = [],
  progress,
  relief,
  leaving = false,
  className,
}: {
  /** The stage under way, said to the player. */
  label: string;
  /** The stages already done, in order. */
  done?: string[];
  /** How much of the stage under way is done, when it can be counted. */
  progress?: { done: number; total: number };
  relief?: ReliefPicture;
  /** Fade out, as the map underneath is ready. */
  leaving?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "relative flex h-full items-center justify-center overflow-hidden bg-[#05070f] transition-opacity motion-reduce:transition-none",
        leaving && "pointer-events-none opacity-0",
        className,
      )}
      style={{ transitionDuration: `${MAP_LOADING_FADE_MS}ms` }}
    >
      {relief && <Relief picture={relief} />}
      <BracketFrame accent="teal" className="w-72 px-4 py-3">
        <ol className="space-y-1.5 font-display text-[11px] uppercase tracking-[0.18em]">
          {done.map((stage) => (
            <li
              key={stage}
              className={cn("flex items-center gap-2", HUD_DIM_INK_CLASS)}
            >
              <Check className="size-3.5 shrink-0" aria-hidden />
              {stage}
            </li>
          ))}
          <li className={cn("flex items-center gap-2", HUD_INK_CLASS)}>
            <Loader2
              className="size-3.5 shrink-0 motion-safe:animate-spin"
              aria-hidden
            />
            {label}
          </li>
        </ol>
        {progress && progress.total > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <Progress
              value={(100 * progress.done) / progress.total}
              aria-label={label}
              className="h-1 flex-1"
            />
            <span
              className={cn(
                "font-mono text-[11px] tabular-nums",
                HUD_INK_CLASS,
              )}
            >
              {tileCount(progress)}
            </span>
          </div>
        )}
      </BracketFrame>
    </div>
  );
}

/** How many of the stage's parts are done, as "12 of 48". */
function tileCount({
  done: tilesDone,
  total: tilesTotal,
}: {
  done: number;
  total: number;
}): string {
  return t`${tilesDone} of ${tilesTotal}`;
}

/** The land as a flat picture, filling the screen behind the stages. */
function Relief({ picture }: { picture: ReliefPicture }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.putImageData(
      new ImageData(picture.data, picture.width, picture.height),
      0,
      0,
    );
  }, [picture]);
  // The picture's corner, which is sea, fills the room the picture leaves.
  const [r, g, b] = picture.data;
  return (
    <div
      aria-hidden
      className="absolute inset-0 opacity-60"
      style={{ backgroundColor: `rgb(${r} ${g} ${b})` }}
    >
      <canvas
        ref={ref}
        width={picture.width}
        height={picture.height}
        className="size-full object-contain"
      />
    </div>
  );
}

/**
 * Whether a loading screen is up, and whether it is fading out. It stays
 * mounted for the fade once `loading` turns false. A timer ends it rather
 * than the end of the transition, which never comes in a hidden window.
 */
export function useMapLoadingFade(
  loading: boolean,
  reduceMotion: boolean,
): { shown: boolean; leaving: boolean } {
  const [leaving, setLeaving] = useState(false);
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading !== wasLoading) {
    setWasLoading(loading);
    setLeaving(!loading && !reduceMotion);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), MAP_LOADING_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  return { shown: loading || leaving, leaving };
}
