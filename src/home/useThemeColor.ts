import { useTheme } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { readThemeColor } from "./art";
import { parseColor } from "./proceduralArt";

/**
 * The theme colour as state that follows an accent or base change.
 *
 * `readThemeColor` already re-probes when `--primary` changes, but a render is
 * not when it changes. Picking a new accent re-renders every `useTheme`
 * consumer in the same pass that updated the state, and the provider's effect
 * only swaps the CSS class after that commit, so a card resolving art during
 * that render probes the outgoing colour and then nothing renders again. The
 * page kept the old tint until something unrelated re-rendered it.
 *
 * So the probe is re-read one frame after any theme axis moves, which is when
 * the new variables are actually computable. The docs site's ArtBackdrop
 * solves the same race the same way. Lives outside `art.ts` so that module
 * stays importable without the frame package (its tests, and `background.ts`,
 * run in node).
 */
export function useThemeColor(): string {
  const { accent, base, resolved } = useTheme();
  const [color, setColor] = useState(readThemeColor);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme axes are the trigger, not inputs. The effect reads the document, and these are the three things whose change makes that read come out different.
  useEffect(() => {
    // No frame callback outside a browser (tests): read in the effect itself.
    if (typeof requestAnimationFrame !== "function") {
      setColor(readThemeColor());
      return;
    }
    const raf = requestAnimationFrame(() => setColor(readThemeColor()));
    return () => cancelAnimationFrame(raf);
  }, [accent, base, resolved]);
  return color;
}

/**
 * The accents whose hue animates continuously: picoframe's `pf-hue-cycle`
 * sweeps `--pf-accent-hue` through 360 degrees on a CSS loop, so `--primary`
 * moves every frame with no render to follow it.
 */
const CYCLING_ACCENTS: ReadonlySet<string> = new Set(["rainbow", "opal"]);

/**
 * A CSS filter that keeps drawn art turning with an animated accent, or
 * `undefined` when the accent holds still.
 *
 * Regenerating an SVG per frame is not an option, so the art stays the still
 * picture it is and the compositor turns it: the filter subtracts the hue the
 * drawing was generated at and adds the live `--pf-accent-hue`, which is the
 * same animated variable the rest of the page follows. Under reduced motion
 * the variable rests at 0deg, where the probe also read it, so the filter is
 * a no-op rather than a skew.
 *
 * Only for art Coilbox drew (`bundled`/`procedural` sources): a photograph or
 * a distribution's own image is not theme-tinted and must not hue-cycle.
 * `hue-rotate` is the sRGB matrix approximation rather than a true HSL
 * rotation, which is fine for a decorative sweep.
 */
export function accentHueRotate(
  accent: string,
  themeColor: string,
): string | undefined {
  if (!CYCLING_ACCENTS.has(accent)) return undefined;
  const hue = parseColor(themeColor)?.h;
  if (hue === undefined) return undefined;
  return `hue-rotate(calc(var(--pf-accent-hue) - ${Math.round(hue)}deg))`;
}
