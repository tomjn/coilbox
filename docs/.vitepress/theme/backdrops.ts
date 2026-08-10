/**
 * Which bundled illustration sits behind which page.
 *
 * The drawings come from `src/home/bundledArt.ts`, the same registry the app
 * draws its tool cards from, imported rather than copied so the site and the
 * app cannot drift. `ArtBackdrop.vue` renders whichever one this file names.
 *
 * Keyed on a page's source path rather than its URL, so the site's `base` and
 * `cleanUrls` settings cannot change what matches.
 *
 * A page with no honest match is left out and gets no backdrop. Borrowing a
 * drawing whose subject says nothing about the page would be worse than a
 * plain background: these illustrations are meant to say what a thing is.
 */

export interface Backdrop {
  /** A key of `DRAWINGS` in `src/home/bundledArt.ts`. */
  toolId: string;
  /**
   * Crops the 320x200 canvas to the drawing's own content, dropping the empty
   * foot each one leaves for a card's label band. Left at the full 200 where a
   * drawing runs to the bottom anyway.
   */
  viewHeight?: number;
  /**
   * Scales the subject down from the card tuning it was drawn for. Lower
   * behind running text than behind the homepage hero, which has far less to
   * compete with.
   */
  strength?: number;
  /**
   * Makes the drawing's small circles twinkle. Only worth it on a drawing whose
   * small circles are stars, and only on a page a visitor is looking at rather
   * than reading, which is why the homepage is the one page that asks for it.
   */
  twinkle?: boolean;
}

/**
 * The homepage carries the art harder than a guide can afford to, but not by
 * much. These drawings scale from a 320px canvas to the full width of a
 * browser window, which turns a 4px rule into a bar twenty pixels deep, so
 * what reads as a light touch on a card reads as page furniture here.
 */
const HERO_STRENGTH = 0.5;
const PAGE_STRENGTH = 0.2;

export const BACKDROPS: Record<string, Backdrop> = {
  // A galaxy over a starfield. The most distinctive drawing in the set, and it
  // echoes the conquest map further down the same page. No crop: its stars are
  // scattered over the whole canvas, so cropping only loses some of them. It
  // also carries more strength than the others, having no heavy rule or filled
  // block in it, only small circles and thin arcs.
  "index.md": {
    toolId: "conquest.list",
    strength: HERO_STRENGTH,
    twinkle: true,
  },

  "presets.md": { toolId: "play.skirmish", strength: PAGE_STRENGTH },
  "campaigns.md": { toolId: "campaign.list", strength: PAGE_STRENGTH },
  "scenarios.md": { toolId: "scenario.list", strength: PAGE_STRENGTH },
  "conquest.md": { toolId: "conquest.list", strength: PAGE_STRENGTH },
  "roguelite-run.md": { toolId: "runlite.list", strength: PAGE_STRENGTH },
  "mission-runtime.md": { toolId: "scenario.builder", strength: PAGE_STRENGTH },
  "map-packs.md": { toolId: "downloads.maps", strength: PAGE_STRENGTH },
  "branding-catalog.md": { toolId: "content.games", strength: PAGE_STRENGTH },
  "distributing.md": { toolId: "downloads.browse", strength: PAGE_STRENGTH },
  "portable-mode.md": { toolId: "content.archives", strength: PAGE_STRENGTH },
  "lobby-moderation.md": {
    toolId: "multiplayer.chat",
    strength: PAGE_STRENGTH,
  },
  "tachyon-protocol.md": {
    toolId: "multiplayer.lobby",
    strength: PAGE_STRENGTH,
  },
  "distribution-profile.md": {
    toolId: "content.setupPacks",
    strength: PAGE_STRENGTH,
  },

  // The two model formats take the two model drawings, which is also what the
  // pages that document building with them take. Sharing a drawing is fine:
  // they are pages about the same subject from different angles.
  "lego-builder.md": { toolId: "lego.units", strength: PAGE_STRENGTH },
  "s3o-format.md": { toolId: "lego.units", strength: PAGE_STRENGTH },
  "lego-parts-pack.md": { toolId: "lego.parts", strength: PAGE_STRENGTH },
  "3do-format.md": { toolId: "lego.parts", strength: PAGE_STRENGTH },

  // routes.md is deliberately absent. It documents the app's URL table, and
  // nothing in the registry is about that.
};

export function backdropFor(relativePath: string): Backdrop | undefined {
  return Object.hasOwn(BACKDROPS, relativePath)
    ? BACKDROPS[relativePath]
    : undefined;
}
