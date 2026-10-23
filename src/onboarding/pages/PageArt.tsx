import { useTheme } from "@picoframe/frame";
import { bundledBackdropSvg } from "@/home/bundledArt";
import { accentHueRotate, useThemeColor } from "@/home/useThemeColor";

const LAYER = "pointer-events-none absolute inset-0";

/**
 * Half strength, the docs site's homepage value (`HERO_STRENGTH` in
 * docs/.vitepress/theme/backdrops.ts). A wizard page has as little text as
 * that hero, so the drawing can carry the same weight.
 */
const STRENGTH = 0.5;

/**
 * One of the bundled tool drawings covering the page, tinted from the theme
 * colour and scheme the way the Home cards are, with a fade from the left so a
 * column of text there stays readable. The caller is `relative` and puts its
 * content in a positioned element after this, so the content paints on top.
 *
 * An `<img>` of a data URL rather than a CSS background, because the drawing
 * covers through its own `preserveAspectRatio` and an `<img>` keeps it in the
 * DOM where a test can see it.
 */
export function PageArt({ toolId }: { toolId: string }) {
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
        className={`${LAYER} size-full`}
        style={{ filter: accentHueRotate(accent, themeColor) }}
      />
      <div
        aria-hidden="true"
        className={`${LAYER} bg-gradient-to-r from-background via-background/80 to-transparent`}
      />
    </>
  );
}
