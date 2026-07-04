import { useCallback, useEffect, useRef, useState } from "react";
import { getProfile, type SplashConfig } from "./profile";

/**
 * Startup brand splash: a centered image over a solid backdrop that fades in, holds,
 * then fades the whole overlay out — a timed flash, not a readiness-gated loading
 * screen, so it's fully decoupled from app load state. Rendered above `<AppFrame>`
 * only when the profile supplies a `splash` and the image resolved to a usable src
 * (see `resolveSplashSrc`). Unmounts itself when done; a click or Escape/Enter/Space
 * dismisses it early via a quick fade-out.
 *
 * Timeline as fractions of `duration` (default 3000ms): 0–20% image fades in,
 * 20–70% hold, 70–100% overlay fades out. Under `prefers-reduced-motion` the fades
 * are skipped and it simply shows for `duration` then removes.
 */
const FADE_IN_FRACTION = 0.2;
const FADE_OUT_FRACTION = 0.3;
const DEFAULT_DURATION_MS = 3000;

export default function Splash({
  config,
  src,
}: {
  config: SplashConfig;
  src: string;
}) {
  const duration = config.duration ?? DEFAULT_DURATION_MS;
  const fadeInMs = Math.round(duration * FADE_IN_FRACTION);
  const fadeOutMs = Math.round(duration * FADE_OUT_FRACTION);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [mounted, setMounted] = useState(true);
  // Image starts hidden and fades in; the overlay starts opaque and fades out.
  const [imgShown, setImgShown] = useState(reduceMotion);
  const [fadingOut, setFadingOut] = useState(false);
  // Guards double-dismiss (a click landing during the scheduled fade-out).
  const dismissing = useRef(false);

  // Begin the fade-out and schedule the final unmount. Idempotent.
  const dismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    setFadingOut(true);
    window.setTimeout(() => setMounted(false), reduceMotion ? 0 : fadeOutMs);
  }, [reduceMotion, fadeOutMs]);

  useEffect(() => {
    if (reduceMotion) {
      // No fades: hold the static image, then remove.
      const done = window.setTimeout(() => setMounted(false), duration);
      return () => window.clearTimeout(done);
    }
    // Next frame: flip the image to visible so the CSS transition runs.
    const raf = requestAnimationFrame(() => setImgShown(true));
    // At the fade-out mark, fade the whole overlay out over the remaining time.
    const out = window.setTimeout(dismiss, duration - fadeOutMs);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(out);
    };
  }, [reduceMotion, duration, fadeOutMs, dismiss]);

  // Keyboard dismiss (Escape/Enter/Space). Click is handled on the overlay button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  if (!mounted) return null;

  return (
    <button
      type="button"
      aria-label="Dismiss splash"
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
        border: "none",
        cursor: "pointer",
        // Falls back to the profile's boot background so the splash sits on the same
        // solid colour that painted before the app loaded — no seam between them.
        background:
          config.background ??
          getProfile().background ??
          "hsl(var(--background))",
        opacity: fadingOut ? 0 : 1,
        transition: reduceMotion ? undefined : `opacity ${fadeOutMs}ms ease`,
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          maxWidth: "60%",
          maxHeight: "60%",
          objectFit: "contain",
          opacity: imgShown ? 1 : 0,
          transition: reduceMotion ? undefined : `opacity ${fadeInMs}ms ease`,
        }}
      />
    </button>
  );
}
