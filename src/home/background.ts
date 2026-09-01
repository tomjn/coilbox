import type { CSSProperties } from "react";
import { assetUrl } from "../lib/assetUrl";
import { parseRef } from "../profile/refs";
import { type CardScheme, readColorScheme, readThemeColor } from "./art";
import { homeBackdropSvg } from "./bundledArt";
import { noteHomeIssue, showHomeValue } from "./config";

/**
 * The home page's backdrop: a layer painted behind every zone.
 *
 * Mostly a hook for distributions. A distribution supplies one image and gets a
 * page that looks like theirs. Everyone else gets a default drawing tinted
 * from the theme's own colours.
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
  /** The Coilbox drawing, tinted from theme tokens. What an unconfigured install gets. */
  | { kind: "default" }
  /** Nothing at all: the flat theme background. Only a distribution asks for this. */
  | { kind: "none" }
  /** A distribution's own image, already rewritten onto the `coilbox://` protocol. */
  | { kind: "image"; url: string };

/**
 * The strongest any backdrop layer may composite over the theme background.
 *
 * 5% is not a taste call. It is the bound under which the worst possible supplied
 * image (a flat white or a flat black one) still leaves every text colour on the
 * page at or above WCAG AA, in both ramps and every base preset picoframe ships.
 * Above it, near-black dark backgrounds lose contrast fast, because their
 * luminance is so low that a little added light is a large proportional change.
 *
 * It was 6%, chosen against a *relative* criterion: keep 85% of the contrast the
 * text has on the flat theme. The accessibility pass (#1003) rendered the backdrop
 * for the first time and measured the pixels, and 85% turned out not to be enough.
 * `--muted-foreground` is already the lightest ink that clears AA (#1033), so on
 * the two bases where it has least room, lime and yellow in the light ramp, it has
 * only 5.11:1 to spend: 6% over a flat black image took the greeting's tagline and
 * the tool group labels to 4.48:1, under the 4.5:1 bar. The arithmetic and the
 * rendered pixels agreed to two decimal places, so the constant was wrong rather
 * than the model.
 *
 * AA holds up to 5.75%. 5% is the round value under that, and the margin matters:
 * at the ceiling the worst case sits at 4.51:1, where any later nudge to a token
 * breaks it silently. `background.test.ts` measures the shipped bases against the
 * absolute bar rather than a relative one, so lowering a token re-opens this.
 *
 * The cost is that the backdrop is a mood layer, not a hero image. A distribution
 * that wants art at full strength already has `welcome.html` plus `welcome.css`,
 * which replace the page wholesale and are the sanctioned escape hatch.
 */
export const BACKDROP_MAX_ALPHA = 0.05;

/**
 * The default backdrop: the coil mark over a starfield, drawn in code and
 * tinted from the theme (see {@link homeBackdropSvg}).
 *
 * It replaced a pair of CSS radial gradients that were both too quiet to name
 * and banded visibly, since a page-wide gradient at 3% alpha crosses its whole
 * range in a handful of 8-bit steps. Line art has no slow ramps, so it cannot
 * band, and it is built from `--primary` the same way the wash was, so a
 * distribution that only sets `theme` still gets a backdrop in its own
 * palette. Drawn in code, it keeps working offline and at any window size.
 *
 * Dimmed to {@link BACKDROP_MAX_ALPHA} exactly like a supplied image, so the
 * legibility bound holds by the same one rule for every layer.
 */
export function defaultBackdropUrl(
  themeColor: string,
  scheme: CardScheme,
): string {
  return `data:image/svg+xml,${encodeURIComponent(homeBackdropSvg(themeColor, scheme))}`;
}

/**
 * How strongly the default drawing composites, and why it is allowed past
 * {@link BACKDROP_MAX_ALPHA}.
 *
 * The 5% bound exists for images Coilbox has never seen: a distribution can
 * supply a flat white photograph, and a flat layer changes the background
 * under every word on the page, so the bound has to survive that worst case.
 * The default drawing is Coilbox's own and is nothing like that case. It
 * paints hairline strokes, dots under 3px and a handful of small diamonds
 * over a transparent field, the same no-flat-areas contract the card
 * drawings hold so text bands can sit on them. So the worst it can do under
 * a word is run a thin line through a glyph, not change the surface the text
 * is read against. At the flat-image bound the drawing was invisible on an
 * ordinary monitor, which made the layer pointless.
 *
 * 15% is a taste call inside that argument, not a measured ceiling: high
 * enough that the composition reads as art, low enough that it stays behind
 * the page. Anyone raising it further should look at a light-ramp screenshot
 * first, since shade-on-pale is the direction with less room.
 */
export const DEFAULT_BACKDROP_ALPHA = 0.15;

/**
 * The fade that keeps the top of the page clean, matching the treatment the
 * docs site gives the same art: full strength at the foot, nothing at all
 * behind the greeting. A mask only ever lowers alpha, so it cannot push a
 * layer past the bound.
 */
export const BACKDROP_MASK = "linear-gradient(to top, black 60%, transparent)";

/**
 * A configured background read as a file reference, or null when it is not one.
 *
 * The one predicate for what counts as a backdrop reference. Both the startup
 * probe and the resolver go through it, so the file that gets checked is the file
 * that gets painted.
 */
function backgroundRef(value: unknown): { token: string; path: string } | null {
  if (typeof value !== "string") return null;
  // The same `@.coilbox/` scheme and `coilbox://` rewriting the branded welcome's
  // markup uses (see `profile/welcomeAssets`), so a distribution references its
  // art the one way it already knows.
  const ref = parseRef(value);
  return ref?.kind === "file" ? { token: value.trim(), path: ref.path } : null;
}

// The references loadHomeBackground() probed and could not read, by the token as
// the author wrote it. Replaced wholesale on each load rather than added to, for
// the same reason `markup.ts` replaces its map: a profile reload re-runs the boot
// pipeline and must not leave a stale verdict behind.
let unreadable = new Set<string>();

/**
 * Ask the asset protocol whether a `.coilbox`-relative file is there, without
 * reading it. A one byte range, so a large backdrop is not pulled into memory to
 * answer a yes or no question, and any failure at all reads as "not there".
 */
async function probeAsset(path: string): Promise<boolean> {
  try {
    const res = await fetch(assetUrl(path), {
      headers: { Range: "bytes=0-0" },
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check that a profile's `home.background` file is actually there, before the page
 * draws (issue #1085).
 *
 * A well-formed reference to a file that is not there used to be the one home
 * mistake with no symptom at all: it resolved to a URL, the layer painted nothing,
 * and the page showed the flat theme background, which is exactly what
 * `"background": false` asks for. So a typo in the path and a deliberate switch
 * off looked the same, on the page and on the console.
 *
 * This is the quiet half of the answer. The backdrop composites at
 * {@link BACKDROP_MAX_ALPHA}, so an
 * error box across the page, which is what distribution markup gets, would be far
 * louder than the thing that failed. Instead the reference is probed once at
 * startup, beside the markup load, and a miss falls back to the default wash with
 * a complaint. The wash is what every other bad value gets, so the two mistakes an
 * author can make in this key now look alike, and neither looks like `false`.
 *
 * A no-op for a profile with no backdrop reference, so an unbranded install does
 * no extra IO at startup. `probe` is injected so the resolution is testable
 * without the asset protocol.
 */
export async function loadHomeBackground(
  home: unknown,
  probe = probeAsset,
): Promise<void> {
  const next = new Set<string>();
  const value = (home as { background?: unknown } | null | undefined)
    ?.background;
  const ref = backgroundRef(value);
  if (ref && !(await probe(ref.path))) next.add(ref.token);
  unreadable = next;
}

/**
 * Resolve a distribution's configured background to what the layout should paint.
 *
 * Takes the configured value as an argument rather than reading the profile, so
 * the layout can hand it whatever `resolveHome` carried through untouched.
 *
 * The contract is one file reference or `false`. Anything else is a distribution
 * bug, and falls back to the default with a warning rather than to a blank page:
 * a typo should not be indistinguishable from deliberately switching the backdrop
 * off. A reference {@link loadHomeBackground} could not read falls back the same
 * way, for the same reason.
 *
 * Pass `issues` to collect what it dropped as well as warn about it, which is how
 * the profile health panel reports a bad backdrop without asking a second
 * question (issue #1088). A reference startup never saw is painted rather than
 * doubted: the probe is a check on top of the page, and its absence must not turn
 * a backdrop that works into one the panel calls broken.
 */
export function resolveHomeBackground(
  value: unknown,
  issues?: string[],
): HomeBackdrop {
  if (value === undefined || value === null) return { kind: "default" };
  if (value === false) return { kind: "none" };
  const ref = backgroundRef(value);
  if (ref) {
    if (!unreadable.has(ref.token))
      return { kind: "image", url: assetUrl(ref.path) };
    noteHomeIssue(
      issues,
      `home: could not read background ${ref.token}, painting the default backdrop`,
    );
    return { kind: "default" };
  }
  noteHomeIssue(
    issues,
    `home: ignoring \`background\`, expected an @.coilbox file reference or false, got ${showHomeValue(value)}`,
  );
  return { kind: "default" };
}

/**
 * The inline style for the backdrop layer, or `null` when there is nothing to
 * paint. The layer is composited over the theme background by its caller, which
 * is what {@link BACKDROP_MAX_ALPHA} is measured against: both kinds are an
 * image dimmed by the layer's `opacity`.
 *
 * The default takes the scheme as an argument, read from the document when the
 * caller has nothing better, because the caller that matters (the layout) has
 * a reactive scheme from `useTheme` and the drawing has to repaint when the
 * ramp flips. The theme colour is read from the document each call, which is
 * how the card art chain reads it too.
 */
export function backdropStyle(
  backdrop: HomeBackdrop,
  scheme: CardScheme = readColorScheme(),
  themeColor: string = readThemeColor(),
): CSSProperties | null {
  if (backdrop.kind === "none") return null;
  if (backdrop.kind === "default")
    return {
      backgroundImage: `url("${defaultBackdropUrl(themeColor, scheme)}")`,
      backgroundSize: "cover",
      backgroundPosition: "center bottom",
      opacity: DEFAULT_BACKDROP_ALPHA,
      maskImage: BACKDROP_MASK,
      WebkitMaskImage: BACKDROP_MASK,
    };
  return {
    backgroundImage: `url("${backdrop.url}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    opacity: BACKDROP_MAX_ALPHA,
  };
}
