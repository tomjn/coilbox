import type { CSSProperties } from "react";
import { assetUrl } from "../lib/assetUrl";
import { parseRef } from "../profile/refs";

/**
 * The home page's backdrop: a layer painted behind every zone.
 *
 * Mostly a hook for distributions. A distribution supplies one image and gets a
 * page that looks like theirs. Everyone else gets a default wash built from the
 * theme's own colours.
 *
 * The hard constraint is legibility. A distribution can supply a bright, busy
 * photograph, and the greeting, the tool cards and the onboarding cards all have
 * to stay readable over it, so the backdrop is not painted at full strength: it
 * composites over the theme background at {@link BACKDROP_MAX_ALPHA}. That bound
 * is what makes legibility provable rather than hoped for. `background.test.ts`
 * measures the worst case the bound allows.
 */

/** What to paint behind the home page. */
export type HomeBackdrop =
  /** The Coilbox wash, built from theme tokens. What an unconfigured install gets. */
  | { kind: "default" }
  /** Nothing at all: the flat theme background. Only a distribution asks for this. */
  | { kind: "none" }
  /** A distribution's own image, already rewritten onto the `coilbox://` protocol. */
  | { kind: "image"; url: string };

/**
 * The strongest any backdrop layer may composite over the theme background.
 *
 * 6% is not a taste call. It is the largest value for which the worst possible
 * supplied image (a flat white or a flat black one) still leaves every text
 * colour on the page with at least 85% of the contrast it has on the flat theme,
 * in both the light and dark ramps and every base preset picoframe ships. Above
 * it, near-black dark backgrounds lose contrast fast, because their luminance is
 * so low that a little added light is a large proportional change.
 *
 * The cost is that the backdrop is a mood layer, not a hero image. A distribution
 * that wants art at full strength already has `welcome.html` plus `welcome.css`,
 * which replace the page wholesale and are the sanctioned escape hatch.
 */
export const BACKDROP_MAX_ALPHA = 0.06;

/**
 * The default wash: a soft glow behind the greeting and a fainter lift at the
 * foot of the page.
 *
 * Built from `--primary` and `--foreground` rather than from fixed colours, so a
 * distribution that only sets `theme` gets a backdrop in its own palette, and so
 * the wash inverts sensibly between the light and dark ramps. No bundled image,
 * which keeps this working offline, at any window size, and on a fresh install
 * with nothing downloaded.
 *
 * Every stop carries an explicit alpha, the transparent ends included:
 * `hsl(var(--primary) / 0)` rather than `transparent`, which interpolates
 * through transparent black and greys the gradient out. The two gradients
 * overlap, so it is their alphas summed, not each on its own, that has to stay
 * within {@link BACKDROP_MAX_ALPHA}.
 */
export const DEFAULT_BACKDROP_GRADIENT = [
  "radial-gradient(120% 70% at 50% 0%, hsl(var(--primary) / 0.04), hsl(var(--primary) / 0) 70%)",
  "radial-gradient(90% 60% at 100% 100%, hsl(var(--foreground) / 0.02), hsl(var(--foreground) / 0) 60%)",
].join(", ");

/**
 * Resolve a distribution's configured background to what the layout should paint.
 *
 * Takes the configured value as an argument rather than reading the profile, so
 * it stays pure and testable. The `profile.home` schema that will supply it is
 * issue #998. Until that lands the caller passes `undefined` and every install
 * resolves to the default.
 *
 * The contract is one file reference or `false`. Anything else is a distribution
 * bug, and falls back to the default with a warning rather than to a blank page:
 * a typo should not be indistinguishable from deliberately switching the backdrop
 * off.
 */
export function resolveHomeBackground(value: unknown): HomeBackdrop {
  if (value === undefined || value === null) return { kind: "default" };
  if (value === false) return { kind: "none" };
  if (typeof value === "string") {
    // The same `@.coilbox/` scheme and `coilbox://` rewriting the branded
    // welcome's markup uses (see `profile/welcomeAssets`), so a distribution
    // references its art the one way it already knows.
    const ref = parseRef(value);
    if (ref?.kind === "file") return { kind: "image", url: assetUrl(ref.path) };
  }
  console.warn(
    "home: ignoring background, expected an @.coilbox file reference or false, got",
    value,
  );
  return { kind: "default" };
}

/**
 * The inline style for the backdrop layer, or `null` when there is nothing to
 * paint. The layer is composited over the theme background by its caller, which
 * is what {@link BACKDROP_MAX_ALPHA} is measured against.
 *
 * A supplied image is dimmed by the layer's `opacity`. The default gradient
 * carries its alphas per colour stop instead, because it fades out and a flat
 * opacity cannot express that.
 */
export function backdropStyle(backdrop: HomeBackdrop): CSSProperties | null {
  if (backdrop.kind === "none") return null;
  if (backdrop.kind === "default")
    return { backgroundImage: DEFAULT_BACKDROP_GRADIENT };
  return {
    backgroundImage: `url("${backdrop.url}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    opacity: BACKDROP_MAX_ALPHA,
  };
}
