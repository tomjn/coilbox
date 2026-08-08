/**
 * Step 1 of the card-art chain: the picture a distribution chose itself.
 *
 * A distribution maps a tool id to its own image file, or to `false` for the
 * icon-only card. Whatever it names wins over the user's content, over the
 * bundled illustration and over the procedural floor, because a distribution
 * that has gone to the trouble of shipping a picture for a tool has said the
 * last word on that tool (issue #1000). Every tool it does not name walks the
 * rest of the chain unchanged.
 *
 * This half is the cache the synchronous source reads, and nothing else. What a
 * profile's `art` map means, and how a `@.coilbox/` reference becomes a URL, is
 * {@link ./profileArt}, which `CoilboxHome` calls once above the layout.
 *
 * They are two files for the reason `contentArt.ts` and `useContentCardArt.ts`
 * are two files: `art.ts` registers this source, so anything imported here lands
 * in the import graph of every test that touches the chain, and reading a
 * profile reaches `@picoframe/plugin-sdk`, whose published dist Vitest's node
 * resolver will not load. Keeping that on the other side is what lets the chain
 * stay a pure function that unit tests without a DOM or a Tauri bridge.
 */

import type { CardArtSource } from "./art";

/** Tool id to an image URL, or `false` for the icon-only card. */
export type ArtOverrides = ReadonlyMap<string, string | false>;

/** The published overrides. The only thing {@link overrideCardArt} reads. */
let overrides: ArtOverrides = new Map();

/** The same tools as a set, rebuilt on publish so its identity is stable. */
let overridden: ReadonlySet<string> = new Set();

/**
 * Step 1 of the chain.
 *
 * A map lookup and nothing else, because it runs during a card's render. A tool
 * the distribution did not name is `undefined`, which the chain reads as nothing
 * to say and falls through.
 */
export const overrideCardArt: CardArtSource = ({ toolId }) =>
  overrides.get(toolId);

/**
 * Replace the overrides.
 *
 * Called from `CoilboxHome`'s render rather than from an effect, because a card
 * that painted its own art for one frame and then had it replaced would be a
 * visible flash of the wrong picture. Writing a module store from a render is
 * safe here in a way it would not be for content art: the value is a pure
 * function of a profile that is fixed for the life of the process, so every
 * render publishes the same map and nothing subscribes to the change.
 */
export function publishArtOverrides(next: ArtOverrides): void {
  overrides = next;
  overridden = new Set(next.keys());
}

/**
 * The tools a distribution has spoken for, whether with an image or with
 * `art: false`.
 *
 * Read by `useContentCardArt` to keep those tools out of the sibling picture
 * set. An overridden card will never paint what the content step picks for it,
 * so letting it take a map from the priority list would cost another card its
 * picture and gain nobody anything. See `contentArt.ts`.
 */
export function overriddenTools(): ReadonlySet<string> {
  return overridden;
}

/** Drop the overrides. For tests, and for the branded arm which has no cards. */
export function resetArtOverrides(): void {
  overrides = new Map();
  overridden = new Set();
}
