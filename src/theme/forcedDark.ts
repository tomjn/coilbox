import { type Accent, cn, useTheme } from "@picoframe/frame";

/**
 * The dark ramp held on one subtree, for the two screens whose artwork has no
 * light version (#1809).
 *
 * The conquest galaxy and the warpath map draw a starfield and put a HUD over it.
 * On the light theme that was pale ink on a black sky and white cards over stars,
 * so both routes now stay dark whoever is looking at them.
 *
 * `dark` is what picoframe's own token block keys on, and what Tailwind's `dark:`
 * variant matches, so the HUD's per-ramp accent inks resolve to their dark values
 * inside here. `forced-dark` in `src/index.css` is what makes the ordinary colour
 * utilities follow, and that file explains why they do not follow on their own.
 *
 * The accent is mirrored because an accent's tokens are declared on the same
 * element as `.dark` rather than on an ancestor, so without it a player who chose
 * blue would get the neutral dark ramp on these two routes and nowhere else. The
 * default accent carries no attribute, matching what `ThemeProvider` puts on the
 * document element. `rainbow` and `opal` run their hue cycle off the element that
 * carries the attribute, so on those two the map's chrome cycles a fixed hue apart
 * from the top bar's.
 *
 * What this deliberately does not cover is anything portalled to `document.body`:
 * drawers, popovers, toasts. Those float over the whole window rather than sitting
 * on the canvas, and they keep the player's theme, the same way the top bar does.
 *
 * The leak this is designed against is #1118, where a branded run left its colour
 * on somebody's ordinary install. Nothing here writes to the document element or
 * to a persisted key. The forcing is a class on an element the route owns, so it
 * goes when that element goes, whether that is a navigation, a route swap with no
 * unmount, or an error boundary tearing the page down. `forcedDark.test.tsx` holds
 * that line.
 */
export const FORCED_DARK_CLASS = "dark forced-dark";

/**
 * Props for the element that owns a starfield. Pass your own classes in and they
 * are merged, so this replaces the element's `className` rather than sitting
 * beside it.
 */
export function useForcedDark(className?: string): {
  className: string;
  "data-accent": Accent | undefined;
} {
  const { accent } = useTheme();
  return {
    className: cn(FORCED_DARK_CLASS, className),
    "data-accent": accent === "neutral" ? undefined : accent,
  };
}
