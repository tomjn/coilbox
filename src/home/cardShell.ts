/**
 * The card treatment the welcome zones share when they put text on artwork.
 *
 * Art fills the card, and a band across the foot carries the text over it. The
 * tool grid and the featured map both do this. They were written in parallel and
 * arrived at the same four class strings independently, so this module is where
 * those strings now live, along with the three facts that make them what they
 * are. Each fact was found in a browser rather than deduced, and each is easy to
 * undo by accident, so they are written down here once instead of in each zone.
 *
 * ## Fact one: Tailwind's colour utilities do not work inside the dark island
 *
 * Card art is dark whatever the page's colour scheme, so the text over it must be
 * light even on a light page. Rather than hardcode white, an art card declares
 * itself a dark island with picoframe's `dark` class: `.dark` re-declares
 * `--foreground`, `--background` and the rest on this element, so a distribution
 * that themes its dark ramp themes these cards, and in dark mode the class is a
 * no-op so one card renders identically in both schemes.
 *
 * Everything inside the island must read the raw picoframe triple,
 * `hsl(var(--token))`, and never Tailwind's `bg-background` / `text-foreground`
 * utility. Tailwind v4 substitutes `var(--background)` into `--color-background`
 * at `:root`, so the utility carries the *page's* scheme into the subtree no
 * matter what `.dark` says here. The raw token substitutes on the element that
 * uses it, which is the whole point.
 *
 * ## Fact two: picoframe's outline button hits fact one
 *
 * The variant is `border-input bg-background`, Tailwind utilities both, so an
 * outline button in the band on a light page paints white and keeps the band's
 * light text, reading as blank. {@link ART_BUTTON_CLASS} is the corrected
 * version, so a zone putting a control on card art takes it rather than
 * rediscovering the bug in a screenshot.
 *
 * ## Fact three: `text-muted-foreground` is not safe over the band
 *
 * That token is calibrated against a 7% background, and on a vivid base it is a
 * saturated colour rather than a grey: over this band it measures 3.0:1, under
 * AA. {@link ART_DIM_CLASS} steps the foreground's alpha down instead, which
 * keeps the same hierarchy and holds 6.8:1.
 *
 * `cardShell.test.ts` measures the band's two text colours against a pure white
 * pixel in every base ramp picoframe ships. White is the ceiling for an image, so
 * that bound covers every picture any art source can ever hand back: a zone that
 * later shows a bundled illustration or content art inherits the guarantee rather
 * than deriving its own. The alphas come out of the shipped strings below, so
 * weakening one re-runs the measurement instead of leaving it stale.
 */

/**
 * Shape, edge and alignment, worn by every welcome card whether or not it shows
 * art. Deliberately no `flex-direction`: the tool grid's icon-only card is a row
 * and its art card is a column.
 */
export const CARD_SHELL_CLASS =
  "group flex w-full rounded-lg border border-border text-left";

/**
 * Layout for a card that stacks: an art window that grows with the card, and the
 * band beneath it. `relative` is what the band's fade positions against, and
 * `overflow-hidden` is what keeps full-bleed art inside the rounded corners.
 */
export const CARD_STACK_CLASS = "relative flex-col overflow-hidden";

/**
 * The art card: a dark island with art edge to edge behind it.
 *
 * `bg-` is a backstop for art that does not cover, whether a transparent
 * illustration or the moment before an image decodes. Without it the light page
 * would show through and take the light text with it.
 *
 * Zones add their own sizing and hover on top. Neither is shared: the tool grid
 * packs fixed-width cards that wrap, and the featured map is one wide card.
 */
export const ART_CARD_CLASS = `${CARD_SHELL_CLASS} ${CARD_STACK_CLASS} dark bg-[hsl(var(--background))]`;

/**
 * The band at the foot of an art card, dimming what is under it enough for its
 * text to clear WCAG AA over any picture at all.
 */
export const ART_BAND_CLASS =
  "relative flex items-center gap-3 bg-[hsl(var(--background)/0.78)] p-3 text-[hsl(var(--foreground))]";

/**
 * A short fade above the band, so it reads as art receding rather than as a bar
 * bolted across the card. Its own top edge is transparent, so no text is ever
 * over it and the measured contrast belongs to the band alone. Goes inside the
 * band, which is what `bottom-full` and `relative` place it against.
 */
export const ART_FADE_CLASS =
  "pointer-events-none absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-[hsl(var(--background)/0.78)] to-transparent";

/** Secondary text in the band: a step down in opacity, for fact three's reason. */
export const ART_DIM_CLASS = "text-[hsl(var(--foreground)/0.75)]";

/**
 * picoframe's outline button, restated as raw tokens for fact two.
 *
 * `cn`'s tailwind-merge drops the variant's own versions, since both are
 * background and border utilities. The same string is correct on a card with no
 * art, where there is no `.dark` above it and the tokens are the page's, which is
 * exactly what the variant would have given.
 */
export const ART_BUTTON_CLASS =
  "border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]";
