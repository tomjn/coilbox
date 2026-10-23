import { useTheme } from "@picoframe/frame";
import { type CSSProperties, useEffect, useState } from "react";
import { bundledBackdropSvg } from "@/home/bundledArt";
import { resolveHome } from "@/home/config";
import { useHomeBackdropStyle } from "@/home/useHomeBackdropStyle";
import { accentHueRotate, useThemeColor } from "@/home/useThemeColor";
import { getProfile, resolveProfileImage } from "@/profile/profile";
import type { WizardArtSpec } from "./pages/registry";

const LAYER = "pointer-events-none absolute inset-0";

/**
 * Half strength, the docs site's homepage value (`HERO_STRENGTH` in
 * docs/.vitepress/theme/backdrops.ts). A wizard page has as little text as
 * that hero, so the drawing can carry the same weight.
 */
const STRENGTH = 0.5;

/** Fades every side of a drawing so it has no edge against the page. */
const SOFT_EDGES =
  "linear-gradient(to right, transparent, black 30%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)";

const SOFT_EDGES_STYLE: CSSProperties = {
  maskImage: SOFT_EDGES,
  WebkitMaskImage: SOFT_EDGES,
  maskComposite: "intersect",
  WebkitMaskComposite: "source-in",
};

/** The same bottom fade the drawings get from {@link SOFT_EDGES}. */
const FOOT_FADE = "linear-gradient(to bottom, black 85%, transparent)";

const FOOT_FADE_STYLE: CSSProperties = {
  maskImage: FOOT_FADE,
  WebkitMaskImage: FOOT_FADE,
};

/**
 * The picture behind the current page. The shell puts it first inside the
 * area above the footer, which is `relative`, and everything after it is
 * positioned, so the page paints on top without a z-index.
 */
export function WizardArt({ art }: { art: WizardArtSpec }) {
  return (
    <div
      aria-hidden="true"
      data-testid="wizard-art"
      className={LAYER}
      // A drawing fades its own edges. The setup picture fills the window, so
      // only its foot meets anything, the footer, and fades the same way.
      style={art === "setup" ? FOOT_FADE_STYLE : undefined}
    >
      {art === "setup" ? <SetupArt /> : <Drawing toolId={art.drawing} />}
    </div>
  );
}

/**
 * One of the bundled tool drawings, tinted from the theme colour and scheme
 * the way the Home cards are. It sits in the right three quarters, anchored
 * right, so its busy part clears the page's left column, and a fade from the
 * left keeps that column readable.
 *
 * An `<img>` of a data URL rather than a CSS background, because happy-dom
 * drops SVG data URLs from inline styles and a test needs to see it.
 */
function Drawing({ toolId }: { toolId: string }) {
  const { resolved, accent } = useTheme();
  const themeColor = useThemeColor();
  const svg = bundledBackdropSvg(toolId, themeColor, resolved, {
    strength: STRENGTH,
  });
  if (!svg) return null;
  return (
    <>
      <img
        src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
        alt=""
        data-testid="page-art"
        data-art={toolId}
        className="absolute inset-y-0 right-0 h-full w-3/4 object-cover object-right"
        style={{
          ...SOFT_EDGES_STYLE,
          filter: accentHueRotate(accent, themeColor),
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-background from-20% via-background/60 via-40% to-transparent to-60%" />
    </>
  );
}

/**
 * The profile's `setupImage`, or the Home backdrop when there is none or it
 * fails to load. `setupImage: false` paints nothing, and so does a profile that
 * switches the Home backdrop off.
 */
function SetupArt() {
  const { setupImage, home } = getProfile();
  // The same backdrop and `home.background` key as the home page, read the way
  // the hub's browse page reads it.
  const backdrop = useHomeBackdropStyle(resolveHome(home).background);
  // undefined while the setup image resolves, so the backdrop never shows first.
  const [image, setImage] = useState<string | null | undefined>(
    typeof setupImage === "string" ? undefined : null,
  );

  useEffect(() => {
    if (typeof setupImage !== "string") return;
    let live = true;
    void resolveProfileImage(setupImage).then((src) => {
      if (live) setImage(src);
    });
    return () => {
      live = false;
    };
  }, [setupImage]);

  if (setupImage === false || image === undefined) return null;
  if (image)
    return (
      <>
        <img
          src={image}
          alt=""
          data-testid="done-setup-image"
          className={`${LAYER} size-full object-cover`}
          onError={() => setImage(null)}
        />
        {/* Keeps the heading readable over a picture at full strength. */}
        <div
          className={`${LAYER} bg-gradient-to-r from-background via-background/70 to-transparent`}
        />
      </>
    );
  return (
    backdrop && (
      <div data-testid="done-backdrop" className={LAYER} style={backdrop} />
    )
  );
}
