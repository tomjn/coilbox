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
 * ## Fact one: the card is an island, and the island takes the page's ramp
 *
 * The card was a permanently dark island: it carried picoframe's `dark` class, so
 * a light page showed a grid of dark tiles and a card was the one thing on the
 * page that had not been asked what scheme the app was in. It now takes the
 * page's ramp, so it is a light card on a light page and the dark card it always
 * was on a dark one (issues #1044 and #1046). Everything else here is unchanged,
 * including the measurement, which now runs over both ramps.
 *
 * The island is still an island, and everything it paints still reads the raw
 * picoframe triple, `hsl(var(--token))`, rather than Tailwind's `bg-background` /
 * `text-foreground` utility. Two reasons, and both survived the change:
 *
 * - Tailwind v4 substitutes `var(--background)` into `--color-background` at
 *   `:root`, so a utility carries the root's ramp into any subtree that
 *   re-declares one. The card does not re-declare one today. Anything nested
 *   inside it might, and a scheme context that only half works is worse than
 *   none.
 * - The alpha. `bg-background/78` mixes in oklab, and the band's whole
 *   justification is a contrast figure computed from a straight sRGB composite.
 *   `hsl(var(--background)/0.78)` is that composite exactly, so the number in
 *   `cardShell.test.ts` describes the pixels a browser actually paints.
 *
 * ## Fact two: picoframe's outline button hits fact one
 *
 * The variant is `border-input bg-background`, Tailwind utilities both. That
 * painted an outline button in the band the page's white while it kept the
 * band's light text, so on a light page the control read as blank.
 * {@link ART_BUTTON_CLASS} restates it in raw tokens. With the card on the page's
 * ramp the two now resolve to the same colours, so this is no longer a bug fix,
 * but a control in the band still takes its colours from the same place as the
 * band around it rather than from a second source that could drift.
 *
 * ## Fact three: `text-muted-foreground` is not safe over the band
 *
 * That token is calibrated against a flat surface, and on a vivid base it is a
 * saturated colour rather than a grey: over this band it measures 2.1:1 against
 * white art, well under AA. {@link ART_DIM_CLASS} steps the foreground's alpha
 * down instead, which keeps the same hierarchy and stays above 4.5:1.
 *
 * `cardShell.test.ts` measures the band's two text colours in both ramps, in every
 * base picoframe ships, over both ends of what an image can be. Black and white
 * are the floor and the ceiling for a picture, and each ramp's worst case sits at
 * one of them: 7.4:1 (name) and 5.0:1 (secondary) on the dark ramp over white art,
 * 8.9:1 and 4.9:1 on the light ramp over black art. That bound covers every
 * picture any art source can hand back, so a zone showing a bundled illustration
 * or a minimap inherits the guarantee rather than deriving its own. The alphas
 * come out of the shipped strings below, so weakening one re-runs the measurement
 * instead of leaving it stale.
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
 * The art card: art edge to edge, on the page's own ramp.
 *
 * `bg-` is a backstop for art that does not cover, whether a transparent
 * illustration or the moment before an image decodes. Without it whatever is
 * behind the card shows through and the band's text loses what it was measured
 * against.
 *
 * Zones add their own sizing and hover on top. Neither is shared: the tool grid
 * packs fixed-width cards that wrap, and the featured map is one wide card.
 */
export const ART_CARD_CLASS = `${CARD_SHELL_CLASS} ${CARD_STACK_CLASS} bg-[hsl(var(--background))]`;

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
 * art, which is what it has always resolved to there and what every card
 * resolves to now.
 */
export const ART_BUTTON_CLASS =
  "border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]";
