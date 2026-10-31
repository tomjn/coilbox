/**
 * The Open Annihilation welcome card's own picture (issue #4966), and the id the
 * card is drawn under.
 *
 * This is the `shipped` step of the card-art chain: an image file Coilbox
 * carries and paints as it is. It is not a `bundled` drawing, which is an SVG
 * Coilbox generates in the theme's colours, so it stays out of the SVG measuring
 * in `bundledArt.test.ts` and out of the hue rotation `ToolCard` gives drawn art
 * (a picture is not theme-tinted, so there is nothing for it to keep up with).
 *
 * It sits below `override` and `content`, so a distribution's per-tool art
 * replaces it, and `art: false` still gives the icon-only card.
 *
 * Kept apart from the card component for the reason `artOverride.ts` is kept
 * apart from its loader: `art.ts` registers this source, so anything imported
 * here lands in the import graph of every test that touches the chain.
 */

import type { CardArtSource } from "./art";
import oaPicture from "./images/open-annihilation.webp";

/**
 * The tool id the card is drawn, and given art, under. It is not a nav item, so
 * nothing else uses it, but a distribution's per-tool art settings key on it
 * like any other card's.
 */
export const OA_CARD_ID = "multiplayer.open-annihilation";

/** Step 3 of the chain. A map lookup, because it runs during a card's render. */
export const shippedCardArt: CardArtSource = ({ toolId }) =>
  toolId === OA_CARD_ID ? oaPicture : undefined;
