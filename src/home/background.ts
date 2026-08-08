import type { CSSProperties } from "react";
import { assetUrl } from "../lib/assetUrl";
import { parseRef } from "../profile/refs";
import { noteHomeIssue, showHomeValue } from "./config";

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
 * This is the quiet half of the answer. The backdrop composites at 6% alpha, so an
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
      `home: could not read background ${ref.token}, painting the default wash`,
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
