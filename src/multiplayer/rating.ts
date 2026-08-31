import type { Rating } from "./bindings";

/**
 * Reading a player's rating out in words (issue #2002).
 *
 * A rating is not one number. Zero-K keeps a casual one and a matchmaking one
 * for the same person at the same time, both live, and they are often far
 * apart, so anything that draws a single figure has to be able to say which one
 * it drew. Tachyon carries one number with no category on it, and Teiserver has
 * never filled it. TASServer has none at all.
 *
 * So the normal answer here is nothing, and nothing means nothing drawn. A dash
 * or a zero in the roster would say the server rated somebody badly rather than
 * that it rated nobody.
 */

/** One rating, with the name of what it measures. */
export interface RatingPart {
  label: string;
  value: number;
}

/**
 * Every rating a record carries, best-known first. Pure.
 *
 * Casual leads because most rooms in the battle list are custom battles, and
 * that is the rating a custom battle counts toward. Whatever leads is what an
 * inline badge with room for one number shows.
 */
export function ratingParts(rating: Rating | undefined): RatingPart[] {
  if (!rating) return [];
  const parts: RatingPart[] = [];
  if (rating.casual != null)
    parts.push({ label: "Casual", value: rating.casual });
  if (rating.matchmaking != null) {
    parts.push({ label: "Matchmaking", value: rating.matchmaking });
  }
  // No category, because the server named none.
  if (rating.overall != null)
    parts.push({ label: "Rating", value: rating.overall });
  return parts;
}

/**
 * Every rating in one line, for the label on a badge that can only show one of
 * them. Null when there is nothing to read out. Pure.
 */
export function ratingSummary(rating: Rating | undefined): string | null {
  const parts = ratingParts(rating);
  if (parts.length === 0) return null;
  return parts
    .map(({ label, value }, i) =>
      i === 0 ? `${label} ${value}` : `${label.toLowerCase()} ${value}`,
    )
    .join(", ");
}
