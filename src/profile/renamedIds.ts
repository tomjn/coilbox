/**
 * Ids that were renamed under a distribution profile author's feet.
 *
 * A distribution ships `profile.json` inside its own bundle, so renaming an id
 * this repo publishes breaks a file nobody here can edit. Every id a profile can
 * name is read through {@link canonicalProfileId}, so `"hide": ["content.games"]`
 * keeps hiding the Games card after Content became Library.
 *
 * Three surfaces key off these ids and all three go through this map: `hide`
 * (nav item ids), `hideSettings` (settings section ids) and the home page's
 * `art` map (nav item ids again).
 *
 * Its own module, and free of React, so the pure readers (`health.ts`,
 * `home/profileArt.ts`) can use it without pulling the frame in.
 */

/**
 * Old id to new, for every id a shipped profile could be holding.
 *
 * The bare `content` entry is the settings group, which renamed alongside the
 * nav group of the same name. `content.setupPacks` is deliberately absent: it
 * gates the hub screen's "Share a pack" button rather than anything in the
 * Library, so it kept its name.
 *
 * Nothing prunes this. An old id costs one entry, and dropping one silently
 * breaks a build already in someone's hands.
 *
 * A `Map` rather than an object literal, for the reason `readArtMap` gives: the
 * ids come from a file an author wrote, so one spelled `__proto__` has to be a
 * key that misses like any other. An object lookup would answer that one with
 * `Object.prototype` and hand a non-string back to every caller.
 */
export const RENAMED_PROFILE_IDS: ReadonlyMap<string, string> = new Map([
  ["content", "library"],
  ["content.maps", "library.maps"],
  ["content.games", "library.games"],
  ["content.blueprints", "library.blueprints"],
  ["content.archives", "library.archives"],
]);

/** The current id for one a profile may have written under an older name. */
export function canonicalProfileId(id: string): string {
  return RENAMED_PROFILE_IDS.get(id) ?? id;
}
