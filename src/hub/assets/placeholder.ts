/**
 * The rung that cannot fail: what to draw for a map when there is no picture of
 * it anywhere (issue #1637).
 *
 * Every rung above this one in `./picture.ts` depends on something that can be
 * absent, an installed archive or a hub row, so this is the rung the hub browser
 * reaches for a map nobody has covered. It is worth drawing properly rather than
 * leaving as the thing nobody looks at.
 *
 * How much of the corpus that is has moved. It used to be nearly all of it,
 * because the hub held no minimaps at all until a maintainer ran a seed. Since
 * issue #2379 anybody with the archive can send one from Settings, so what
 * reaches this rung is a map nobody has run either for.
 *
 * A description rather than a component's props, so the ladder resolves and
 * tests with nothing rendered. `./MapPicture.tsx` turns it into markup. This is
 * the same split the hub makes at `lib/assets/placeholder.ts`, and the numbers
 * here are that file's, so a map with no picture is drawn the same way in the
 * website and in the app.
 *
 * Maps only. A unit with no picture is already drawn as its footprint on the
 * blueprint plan, which is a better answer than a dashed box, so nothing here
 * needs to know about units.
 */

/**
 * A map's size the way BAR names one: 512 elmo units, so a 6144 elmo map is 12.
 * Not elmos, and not the hub's `map_width`, which is in elmos. "12 by 12" is how
 * a person recognises a map and "6144 by 6144" is not.
 */
export interface MapSize {
  width: number;
  height: number;
}

/** Everything needed to draw a picture that does not exist. */
export interface MissingMapPicture {
  /** The map's full name, version and all, as unitsync and the hub spell it. */
  name: string;
  /** Null when nothing knew the size, which draws a square rather than refusing
   *  to draw. */
  size: MapSize | null;
}

/** The longer side of the box a placeholder is drawn in, in user units. The
 *  shorter side is however much less the size says. */
const LONGEST = 100;

/**
 * The most out of square a placeholder is drawn, as a ratio of its sides.
 *
 * Not a correction to the size: no real map reaches eight to one, so this never
 * fires on one. It is here because the size comes off somebody else's map list
 * rather than out of an archive, and a thousand to one value would otherwise
 * draw a line one pixel tall that reads as a rendering fault.
 */
const MOST_ELONGATED = 8;

/** A dimension the drawing can use, or null for anything that would put a zero,
 *  a negative or a NaN into a `viewBox`. */
function usable(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The box to draw the map in, normalised so the longer side is {@link LONGEST}.
 *
 * Normalised rather than drawn in the map's own numbers, so every placeholder
 * shares one `viewBox` and the strokes and corners in the drawing are a set of
 * numbers rather than a scale factor.
 */
export function placeholderBox(size: MapSize | null): MapSize {
  const square = { width: LONGEST, height: LONGEST };
  if (!size) return square;

  const width = usable(size.width);
  const height = usable(size.height);
  if (width === null || height === null) return square;

  const ratio = Math.min(
    Math.max(width / height, 1 / MOST_ELONGATED),
    MOST_ELONGATED,
  );
  return ratio >= 1
    ? { width: LONGEST, height: LONGEST / ratio }
    : { width: LONGEST * ratio, height: LONGEST };
}

/** Map sizes are whole numbers, and a stray fraction from somebody's list is a
 *  measurement nobody asked for. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The size as a caption, or null when there is none to say. No noun after it,
 * because "12 by 12" is exactly how BAR, the lobby and every player names a map
 * size and appending one would invent a unit.
 */
export function placeholderMeasure(picture: MissingMapPicture): string | null {
  const size = picture.size;
  if (!size) return null;

  const width = usable(size.width);
  const height = usable(size.height);
  if (width === null || height === null) return null;

  return `${round(width)} by ${round(height)}`;
}

/**
 * What the drawing says to somebody who cannot see it.
 *
 * It says there is no picture rather than describing a box, so a reader using a
 * screen reader learns the same thing a sighted reader learns from a dashed
 * outline: nothing anywhere has a picture of this map.
 */
export function placeholderLabel(picture: MissingMapPicture): string {
  const measure = placeholderMeasure(picture);
  return measure
    ? `No picture of ${picture.name}, a ${measure} map`
    : `No picture of ${picture.name}`;
}
