/**
 * What a distribution's `art` map means: the reading half of the per-tool art
 * override (issue #1000).
 *
 * The contract is one entry per tool id, and each entry is either a
 * `@.coilbox/<path>` reference to a file in the distribution's own folder or
 * `false` for the icon-only card:
 *
 * ```jsonc
 * { "zone": "cards",
 *   "art": { "warpath": "@.coilbox/art/warpath.png", "play.replays": false } }
 * ```
 *
 * `@.coilbox/` is the one namespace that names a file, and `parseRef` is what
 * says so, so this reuses it rather than accepting a second kind of path. A bare
 * `art/warpath.png` is rejected for that reason: it looks like it would work,
 * and a scheme that resolves relative paths from two places is how a distribution
 * ends up able to read outside its own folder.
 *
 * Like the rest of the `home` schema, a mistake here costs the tool it was
 * written for and nothing else. A malformed entry warns and is dropped, so that
 * tool walks the rest of the chain and still gets a picture. A malformed `art`
 * key warns and drops the lot. Neither can blank a card, because step 4 of the
 * chain always succeeds.
 *
 * ## Why the art lives on the cards zone
 *
 * Because that is where the design spec put it, and it is where an author looks
 * for it. The cost is real and worth naming: `art` is only readable from a
 * `zones` list, so a distribution that wants to change one tool's picture has to
 * write the whole page out and thereby pin it. Anything better than that is a
 * change to the contract rather than to this file.
 *
 * ## Why an arbitrary image is safe to put under card text
 *
 * A distribution's own image is the one art source Coilbox cannot repalette, and
 * the label sits over it. The band under the label is measured against a black
 * picture and a white one, which bracket every image there can be, in both
 * colour schemes and in every base picoframe ships. See `cardShell.test.ts`. So
 * the guarantee already covers whatever file a distribution names, and this
 * module does not have to inspect a single pixel of it.
 */

import { assetUrl } from "../lib/assetUrl";
import { parseRef } from "../profile/refs";
import { canonicalProfileId } from "../profile/renamedIds";
import type { ArtOverrides } from "./artOverride";
import { type HomeEntry, noteHomeIssue, showHomeValue } from "./config";

/** No overrides, which is what every distribution without an `art` map has. */
const NONE: ArtOverrides = new Map();

/**
 * The per-tool art a resolved page configures, ready for the chain.
 *
 * Takes the resolved entries rather than the raw profile, so a repeated `cards`
 * zone resolves the same way here as it does on screen: `resolveHome` has
 * already dropped the second one, and this reads whichever survived.
 *
 * Pass `issues` to collect what it dropped as well as warn about it, which is how
 * the profile health panel reports bad art without asking a second question.
 */
export function resolveCardArtOverrides(
  entries: readonly HomeEntry[],
  issues?: string[],
): ArtOverrides {
  const cards = entries.find((e) => e.kind === "zone" && e.zone === "cards");
  return cards ? readArtMap(cards.entry.art, issues) : NONE;
}

/**
 * One `art` map, validated.
 *
 * A `Map` rather than the author's object, so a tool id spelled `constructor` or
 * `__proto__` is a key like any other rather than a lookup that resolves an
 * inherited Object property.
 */
export function readArtMap(value: unknown, issues?: string[]): ArtOverrides {
  if (value === undefined || value === null) return NONE;
  if (typeof value !== "object" || Array.isArray(value)) {
    noteHomeIssue(
      issues,
      `home: ignoring \`art\`, expected an object, got ${showHomeValue(value)}`,
    );
    return NONE;
  }
  const overrides = new Map<string, string | false>();
  for (const [toolId, entry] of Object.entries(value)) {
    const art = toolArt(toolId, entry, issues);
    // Keyed by nav item id, so an id renamed since the profile was written
    // would drop the author's picture and put a stock one back with no warning.
    // Same map the `hide` list is read through.
    if (art !== undefined) overrides.set(canonicalProfileId(toolId), art);
  }
  return overrides;
}

/**
 * One tool's art: a URL, `false` for the icon-only card, or `undefined` when the
 * author wrote something this cannot honour and the tool should walk the chain.
 */
function toolArt(
  toolId: string,
  value: unknown,
  issues?: string[],
): string | false | undefined {
  if (value === false) return false;
  if (typeof value === "string") {
    // The same `@.coilbox/` scheme and `coilbox://` rewriting the backdrop and
    // the branded welcome's markup use, so a distribution references its art the
    // one way it already knows.
    const ref = parseRef(value);
    if (ref?.kind === "file") return assetUrl(ref.path);
  }
  noteHomeIssue(
    issues,
    `home: ignoring art for ${showHomeValue(toolId)}, expected an @.coilbox file reference or false, got ${showHomeValue(value)}`,
  );
  return undefined;
}
