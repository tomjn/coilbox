/**
 * One art resolver for the whole home page. Every zone that shows card art calls
 * {@link resolveCardArt}, and no zone carries its own fallback logic.
 *
 * Four sources, tried in order:
 *
 * 1. `override`: the distribution's per-tool art (issue #1000).
 * 2. `content`: art derived from the user's install, such as a last-played map's
 *    minimap, a campaign panorama, or a Warpath run's galaxy (issue #989).
 * 3. `bundled`: an illustration Coilbox ships for that tool (issue #990).
 * 4. `procedural`: a pattern seeded from the tool id and the theme colour.
 *
 * Step 4 always succeeds, so no card is ever artless and none of the art work
 * above blocks on artwork existing. It also means the three sources above are
 * genuinely optional and can land in any order.
 *
 * ## Adding a source
 *
 * A source is a plain function of a {@link CardArtRequest}. Registration is by
 * step name rather than by call order, so whichever sibling issue lands first
 * does not decide the priority of the ones after it. A new source is two lines
 * at the foot of this file: import the source from its own module, then pass it
 * to {@link registerCardArtSource} with the step it fills. The source module
 * imports only types from here, and types erase, so there is no import cycle.
 *
 * ## Why sources are synchronous
 *
 * First paint must not wait on art, and the procedural floor means it never has
 * to. A source needing data it does not have yet returns undefined, the card
 * paints the procedural pattern, and the source returns a URL on a later render
 * once its own cache is warm. That keeps the chain a pure function, so it unit
 * tests without a DOM and a card never blocks on a unitsync call.
 *
 * For the same reason a source reads its own data rather than being handed it.
 * The request carries only what every card needs, so a new source does not
 * widen the interface for the ones already there.
 */

import { FALLBACK_THEME_COLOR, proceduralCardArt } from "./proceduralArt";

/** The steps above the procedural floor, in the order they are tried. */
export type CardArtStep = "override" | "content" | "bundled";

/** Which step answered. `procedural` is the floor and is never registered. */
export type CardArtSourceName = CardArtStep | "procedural";

/** Steps in priority order. The floor is not in here, it is unconditional. */
const STEPS: readonly CardArtStep[] = ["override", "content", "bundled"];

/** What a source is asked about. */
export interface CardArtRequest {
  /** The nav item's id, which is also the key a distribution's `art` map uses. */
  toolId: string;
  /** The app's current theme colour, as a CSS colour string. */
  themeColor: string;
}

/**
 * A source's answer. A URL wins. `false` also wins and means this tool takes no
 * art at all, which is the icon-only card and the `art: false` of the
 * distribution contract. `undefined` or an empty string means "nothing from me"
 * and falls through to the next step.
 */
export type CardArtSource = (
  request: CardArtRequest,
) => string | false | undefined;

/** What a card should paint, and which step decided it. */
export type CardArt =
  | { kind: "art"; url: string; source: CardArtSourceName }
  | { kind: "icon"; source: CardArtSourceName };

const sources = new Map<CardArtStep, CardArtSource>();

/**
 * Register the source for one step, replacing any source already there. Returns
 * a function that removes it again, which is what tests use to keep the registry
 * clean between cases.
 */
export function registerCardArtSource(
  step: CardArtStep,
  source: CardArtSource,
): () => void {
  sources.set(step, source);
  return () => {
    if (sources.get(step) === source) sources.delete(step);
  };
}

/**
 * Resolve the art for one tool.
 *
 * `themeColor` is read from the document when the caller does not pass one, so
 * every card on a page shares the same theme without the caller threading it
 * through. Tests pass it explicitly and so stay free of a DOM.
 */
export function resolveCardArt(
  toolId: string,
  themeColor: string = readThemeColor(),
): CardArt {
  const request: CardArtRequest = { toolId, themeColor };
  for (const step of STEPS) {
    const answer = sources.get(step)?.(request);
    if (answer === false) return { kind: "icon", source: step };
    if (answer) return { kind: "art", url: answer, source: step };
  }
  return {
    kind: "art",
    url: proceduralCardArt(toolId, themeColor),
    source: "procedural",
  };
}

/** The last probe, memoised against the raw `--primary` it was taken from. */
let probed: { key: string; color: string } | undefined;

/**
 * A colour no theme would choose, painted on the probe's parent so the probe
 * inherits it. Reading it back means the probe learned nothing.
 */
const SENTINEL = "rgb(1, 2, 3)";

/**
 * The theme's primary colour, resolved to something parseable.
 *
 * Reading `--primary` directly does not work. picoframe's default scheme defines
 * it through a `calc()`, and a `calc()` inside an unregistered custom property is
 * never evaluated, so the computed value is a token soup rather than a colour.
 * Painting it on a real element and reading the result back gives an `rgb()`
 * triple whatever form the theme used, including a distribution's `profile.theme`
 * override and a campaign's scoped accent.
 *
 * ## Why the probe sits inside a sentinel
 *
 * When `hsl(var(--primary))` does not resolve to a colour, CSS does not drop the
 * declaration and leave the previous one standing. The property is invalid at
 * computed-value time, and for an inherited property that means inherit. So the
 * naive probe silently returned whatever colour the page's text happened to be
 * at that instant, which depends on how far the stylesheets had got. Two launches
 * of the same build on the same install read two different hues (issue #1047).
 *
 * Putting the probe inside a parent painted {@link SENTINEL} turns that silent
 * wrong answer into a detectable one: the inherited colour is now a value no
 * theme uses, so reading it back means the theme said nothing and the fixed
 * fallback is the honest answer. Fixed, so it is the same on every launch.
 *
 * The result is memoised against the raw custom property, which does change when
 * the accent or the base hue changes. Switching theme in Appearance therefore
 * re-probes, while a page of cards does not force a style recalculation each.
 *
 * An empty `--primary` means the theme's stylesheet has not applied yet, and it
 * is not memoised. Caching that probe would hold a guess for the rest of the
 * session even after the real colours arrived (issue #1043).
 */
export function readThemeColor(): string {
  if (typeof document === "undefined") return FALLBACK_THEME_COLOR;
  const root = document.documentElement;
  const key = getComputedStyle(root).getPropertyValue("--primary").trim();
  if (!key) return FALLBACK_THEME_COLOR;
  if (probed?.key === key) return probed.color;

  const holder = document.createElement("span");
  holder.style.setProperty("position", "absolute");
  holder.style.setProperty("width", "0");
  holder.style.setProperty("height", "0");
  holder.style.setProperty("overflow", "hidden");
  holder.style.setProperty("color", SENTINEL);
  const probe = document.createElement("span");
  probe.style.setProperty("color", "hsl(var(--primary))");
  holder.appendChild(probe);
  root.appendChild(holder);
  const measured = getComputedStyle(probe).color;
  holder.remove();

  const color = themeColorFrom(measured);
  probed = { key, color };
  return color;
}

/**
 * What to make of one probe reading.
 *
 * Pure, and exported, because the interesting part of the probe is the condition
 * under which its answer is worthless rather than the answer itself, and that is
 * not something a value assertion catches.
 */
export function themeColorFrom(measured: string): string {
  const seen = measured.trim();
  if (!seen || seen === SENTINEL) return FALLBACK_THEME_COLOR;
  // Written without spaces by some engines, and the sentinel is the one value
  // whose exact spelling matters here.
  if (seen.replace(/\s+/g, "") === SENTINEL.replace(/\s+/g, "")) {
    return FALLBACK_THEME_COLOR;
  }
  return seen;
}

/** Drop the memoised theme colour. For tests, and for a hard theme reload. */
export function forgetThemeColor(): void {
  probed = undefined;
}

import { bundledCardArt } from "./bundledArt";

registerCardArtSource("bundled", bundledCardArt);

import { contentCardArt } from "./contentArt";

registerCardArtSource("content", contentCardArt);
