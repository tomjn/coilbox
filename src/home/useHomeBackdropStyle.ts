import { useTheme } from "@picoframe/frame";
import type { CSSProperties } from "react";
import { backdropStyle, resolveHomeBackground } from "./background";
import { accentHueRotate, useThemeColor } from "./useThemeColor";

/**
 * The home page's backdrop style, for a `home.background` value already read
 * from the profile.
 *
 * Split out of `StackedLayout` so a second page can paint the same backdrop
 * without writing its own version of this chain. `resolveHomeBackground` and
 * `backdropStyle` are what turn a configured value into a style (see
 * `./background` for the legibility bound that pins it), and this is the one
 * place that also folds in the hue rotation for a cycling accent, so a caller
 * cannot pick up one and forget the other.
 *
 * Takes the already-resolved `background` value, the same as `backdropStyle`
 * does, rather than reading the profile itself: `StackedLayout` gets it as a
 * prop from `resolveHome`, and the hub page reads it from `resolveHome` too
 * (see `../hub/pages/BrowsePage.tsx`), both against the one `home.background`
 * key.
 *
 * Returns `null` only when the profile switches the backdrop off
 * (`background: false`). Anything else, including a reference the startup
 * probe could not read, falls back to the default wash rather than a blank
 * layer (see `resolveHomeBackground`).
 */
export function useHomeBackdropStyle(
  background: unknown,
): CSSProperties | null {
  const { resolved, accent } = useTheme();
  const themeColor = useThemeColor();
  const resolvedBackground = resolveHomeBackground(background);
  const backdrop = backdropStyle(resolvedBackground, resolved, themeColor);
  if (backdrop && resolvedBackground.kind === "default") {
    const hueFilter = accentHueRotate(accent, themeColor);
    if (hueFilter) backdrop.filter = hueFilter;
  }
  return backdrop;
}
