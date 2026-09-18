import raw from "../../../shared/asset-vocabulary.json";

/**
 * The names and numbers coilbox and the hub have to agree on before either side
 * can move a picture (issue #1622).
 *
 * Every value here is a hard failure rather than a cosmetic drift. The hub reads
 * the pixel dimensions off the bytes rather than trusting what a client declares,
 * and it refuses a variant it does not recognise, so a name spelled differently
 * in the two repos shows up as a rejected upload on somebody's machine rather
 * than as a compile error here.
 *
 * That is why the values live in `shared/asset-vocabulary.json` and not in this
 * file. `crates/coilbox-assets` reads the same document with `include_str!`, so
 * the encoder in the unitsync worker and the upload client in the hub plugin
 * cannot disagree with the renderer in the webview. Both sides embed it at build
 * time, so `vocabulary.test.ts` and the crate's own tests are what stand between
 * a bad edit and a shipped build.
 *
 * The written half is section 14 of
 * `docs/superpowers/specs/2026-08-14-asset-pipeline-design.md`, which carries the
 * reasoning this file only records the outcome of.
 */

/** Which of the hub's two key shapes addresses this class of picture. */
export type AssetKeyedOn = "unit" | "map";

/**
 * What one class of picture may be, checked against the encoded bytes by the hub
 * at `lib/assets/caps.ts` (coilbox-hub#105). Coilbox holds the same numbers so it
 * can encode to them rather than discover them from a 413.
 */
export interface AssetClass {
  keyedOn: AssetKeyedOn;
  /** The one type this class may be declared and encoded as. */
  mime: string;
  /**
   * What produced the bytes, recorded on the row so a later re-encode pass can
   * target only what needs redoing. It names the codec, the quality and the size
   * cap, because the job of the field is telling last year's output from this
   * year's.
   */
  encodeProfile: string;
  /** Whether the encoding has to preserve every sample. */
  lossless: boolean;
  /** The WebP quality for a lossy class, and null for a lossless one. */
  quality: number | null;
  /** The largest either edge may be, or null when the source decides. */
  maxEdgePx: number | null;
  /**
   * The largest the encoded object may be, or null when the class has no number
   * of its own.
   *
   * Derived rather than chosen: it is the uncompressed size of the largest image
   * `maxEdgePx` permits, four bytes a pixel, so no encoding of a picture this
   * class allows can reach it and anything that does is carrying something other
   * than the picture. `overlay:metal` and `overlay:type` fall through to
   * {@link maxObjectBytes}, because they are the two classes stored at whatever
   * grid the map has.
   */
  maxBytes: number | null;
  square: boolean;
  /** Bits per channel the samples must carry, or null for no requirement. */
  minBitDepth: number | null;
  grayscale: boolean;
}

export interface AssetVocabulary {
  unit: {
    buildpicVariant: string;
    renderVariantPrefix: string;
    renderAngles: readonly string[];
  };
  mapVariants: readonly string[];
  origins: readonly string[];
  classes: Record<string, AssetClass>;
  maxObjectBytes: number;
  renderFrame: {
    bleedSquares: number;
    elmosPerBuildSquare: number;
  };
  mapExtent: {
    elmosPerMetalSample: number;
  };
}

const vocabulary = raw as AssetVocabulary;

/** The only variant a unit has besides a render. */
export const BUILDPIC_VARIANT = vocabulary.unit.buildpicVariant;

/** A unit's other variants are `render:<angle>`. The angle is part of the key, so
 * two renders of one unit from different angles are two assets. */
export const RENDER_VARIANT_PREFIX = vocabulary.unit.renderVariantPrefix;

/**
 * The angles worth rendering, which is four (issue #1951).
 *
 * One of them is a plan and three are pictures of the unit. Renders are the only
 * class in the corpus that scales without a natural bound, so the list is short
 * on purpose: section 5.1 of the asset pipeline design budgets the class at units
 * times angles, and four is what fits under the durable tier's ceiling.
 */
export const RENDER_ANGLES = vocabulary.unit.renderAngles;

/** The angle a plan is drawn from, since a plan is a view from above. Named
 *  rather than written out at the call site, the way {@link MINIMAP_VARIANT} is,
 *  and `vocabulary.test.ts` holds it inside {@link RENDER_ANGLES} so it cannot
 *  become an angle the hub has no pictures for. */
export const TOP_RENDER_ANGLE = "top";

/** What {@link renderPixels} calls the one angle framed on a footprint. The same
 *  string as {@link TOP_RENDER_ANGLE}, under the name the framing rule uses. */
export const PLAN_ANGLE = TOP_RENDER_ANGLE;

/** The angles that are pictures of a unit rather than a plan of one: framed on
 *  the model's own bounds, square, and drawn to be looked at. */
export const PICTURE_ANGLES = RENDER_ANGLES.filter(
  (angle) => angle !== PLAN_ANGLE,
);

/**
 * The map side of the vocabulary, and a closed list, unlike the unit side. None
 * of the four is open ended the way a render angle is, so a typo mints an
 * identity nothing ever asks for.
 */
export const MAP_VARIANTS = vocabulary.mapVariants;

/** The picture of the map itself, as against the three overlays. The one the
 *  picture ladder in `./picture.ts` asks the hub for. Named rather than written
 *  out at the call site, and `vocabulary.test.ts` holds it inside
 *  {@link MAP_VARIANTS} so it cannot become a variant the hub refuses. */
export const MINIMAP_VARIANT = "minimap";

/** How the bytes were produced, not how they arrived. */
export const ASSET_ORIGINS = vocabulary.origins;

/**
 * The caps, keyed on class. `render` covers every `render:<angle>`, since the
 * angle is part of the identity and changes nothing about what the picture may
 * be.
 */
export const ASSET_CLASSES = vocabulary.classes;

/** The class key every `render:<angle>` shares. */
export const RENDER_CLASS = "render";

/** The backstop for a class with no `maxBytes` of its own, matching the hub's
 * `ASSET_MAX_OBJECT_BYTES`. */
export const maxObjectBytes = vocabulary.maxObjectBytes;

/**
 * How many elmos one metal infomap sample spans.
 *
 * The metal infomap is `(mapx / 2, mapy / 2)` samples
 * (`rts/Map/SMF/SMFMapFile.cpp:199`) and a map square is the engine's
 * `SQUARE_SIZE` of 8 elmos, which `CSMFMapFile` refuses to load a map without,
 * so one sample is exactly 16 elmos on every map that loads.
 */
export const ELMOS_PER_METAL_SAMPLE = vocabulary.mapExtent.elmosPerMetalSample;

/**
 * A map's size in elmos, from the metal infomap's sample counts (issue #1629).
 *
 * This is the number the hub's `map_width` and `map_height` hold, and the one an
 * overlay is lined up against. Three other counts describe the same map and none
 * of them is this: the metal samples that go in, the height infomap's
 * `(mapx + 1, mapy + 1)` vertices, and the "8 x 8" the community says, which is
 * these elmos over 512 and a display convention rather than a length. Beyond All
 * Reason's `BarMap.mapWidth` holds that last one, so a 12 there is 6144 here.
 */
export function mapExtentElmos(
  metalSamplesX: number,
  metalSamplesZ: number,
): { widthElmos: number; heightElmos: number } {
  return {
    widthElmos: metalSamplesX * ELMOS_PER_METAL_SAMPLE,
    heightElmos: metalSamplesZ * ELMOS_PER_METAL_SAMPLE,
  };
}

/** The full variant string for one render angle. */
export function renderVariant(angle: string): string {
  return `${RENDER_VARIANT_PREFIX}${angle}`;
}

/**
 * The caps for one variant, or null when it is not a variant the hub stores
 * pictures for. Mirrors the hub's `capForVariant`, including the render prefix
 * rule.
 */
export function classForVariant(variant: string): AssetClass | null {
  if (variant.startsWith(RENDER_VARIANT_PREFIX))
    return ASSET_CLASSES[RENDER_CLASS] ?? null;
  return ASSET_CLASSES[variant] ?? null;
}

/**
 * The least bleed a render carries on each side, in whole build squares.
 *
 * Models overhang their footprints, so a render framed exactly on the footprint
 * clips them. A clipped radar dish reads as broken and a centred one does not, so
 * the frame is widened by whole squares on every side.
 *
 * A floor rather than the whole rule since issue #2952. One square covers most
 * units and not all: measured over Balanced Annihilation's 379 units, 331 fit
 * inside a square of bleed and the widest, the 8 by 8 Vulcan, reaches 73 elmos
 * past its footprint, which is 4.56 squares. So {@link fittingBleed} widens the
 * frame per unit from the model's own reach, and {@link bleedFromPixels} is how a
 * consumer reads back the one that was used.
 */
export const RENDER_BLEED_SQUARES = vocabulary.renderFrame.bleedSquares;

/** Elmos per build square: two of the engine's `SQUARE_SIZE`, the same 16 that
 * `src/lego/unitDef.ts` uses. */
export const ELMOS_PER_BUILD_SQUARE =
  vocabulary.renderFrame.elmosPerBuildSquare;

/** The frame one unit's top down render is taken in. */
export interface RenderFrame {
  /** The bleed this frame was taken with, in whole build squares each side. At
   *  least {@link RENDER_BLEED_SQUARES} and as much more as the model needed. */
  bleedSquares: number;
  /** The framed extent, footprint plus the bleed on both sides. */
  squaresX: number;
  squaresZ: number;
  /** The same extent in elmos, which is what the orthographic camera is set to. */
  widthElmos: number;
  heightElmos: number;
  /** The encoded image, at the class cap or under it, in the footprint's aspect. */
  widthPx: number;
  heightPx: number;
  /** Whole pixels per build square, so the aspect is exact rather than rounded. */
  pixelsPerSquare: number;
}

/**
 * The frame for a top down render of a unit with this footprint (issue #1631).
 *
 * The footprint sets the aspect. A 3 by 2 building renders 3 by 2 and never
 * square, because the picture exists to tile into a base layout and a square one
 * does not. This is the rule the hub cannot check for itself, since it does not
 * hold footprints, so being wrong here is not caught anywhere downstream.
 *
 * `footprintX` and `footprintZ` are the unitdef's `footprintx` and `footprintz`
 * in build squares, as `--unit-dataset` reports them, and the engine floors both
 * at 1. `bleedSquares` is what {@link fittingBleed} worked out this unit's model
 * needs, and defaults to the floor for a caller that has no model to measure.
 *
 * Pixels come out as a whole number per square so the encoded aspect is exactly
 * the framed aspect rather than a rounding of it. A footprint wide enough that a
 * square would be under a pixel cannot be framed inside the cap at all. Nothing
 * in any game is near that, and the floor of 1 keeps the result an image rather
 * than nothing.
 *
 * Orientation, which is the other half of the rule and is easier to rediscover
 * wrongly than to look up: the model's +z is the front and its +x is the unit's
 * left. Looking down on it, the front is the top of the image and the unit's left
 * is the left of the image, so the image's rightwards axis is world -x and its
 * downwards axis is world -z.
 */
export function renderFrame(
  footprintX: number,
  footprintZ: number,
  bleedSquares: number = RENDER_BLEED_SQUARES,
): RenderFrame {
  const bleed = Math.max(RENDER_BLEED_SQUARES, Math.trunc(bleedSquares));
  const squaresX = Math.max(1, Math.trunc(footprintX)) + 2 * bleed;
  const squaresZ = Math.max(1, Math.trunc(footprintZ)) + 2 * bleed;

  const cap = ASSET_CLASSES[RENDER_CLASS].maxEdgePx ?? 0;
  const pixelsPerSquare = Math.max(
    1,
    Math.floor(cap / Math.max(squaresX, squaresZ)),
  );

  return {
    bleedSquares: bleed,
    squaresX,
    squaresZ,
    widthElmos: squaresX * ELMOS_PER_BUILD_SQUARE,
    heightElmos: squaresZ * ELMOS_PER_BUILD_SQUARE,
    widthPx: squaresX * pixelsPerSquare,
    heightPx: squaresZ * pixelsPerSquare,
    pixelsPerSquare,
  };
}

/**
 * The widest frame that can still be drawn at a whole pixel per build square.
 *
 * Past this the frame has more squares than the class cap has pixels, so
 * `pixelsPerSquare` floors at 1 and two different bleeds start producing the same
 * picture. Both searches below stop here for that reason, and it is derived from
 * the cap rather than picked.
 */
const MAX_FRAME_SQUARES = ASSET_CLASSES[RENDER_CLASS].maxEdgePx ?? 0;

/**
 * The bleed this unit's frame needs, from how far its model reaches (issue
 * #2952).
 *
 * `reachX` and `reachZ` are how far the model's bounds reach from the unit's own
 * origin in elmos, on each axis, taking whichever side reaches further. The
 * origin rather than the model's centre because that is where
 * `topDownCamera` points: the engine stands a unit's model at the unit's
 * position and the footprint is centred there, so an asymmetric model overhangs
 * unevenly and the frame has to cover the worse side.
 *
 * **The result is one a consumer can read back.** {@link bleedFromPixels}
 * recovers the bleed from the picture's pixel size and the footprint, because
 * nothing carries it alongside the bytes. A handful of frames encode to the same
 * pixel size as a narrower one would, all of them square footprints: a 1 by 1 at
 * a bleed of 1 and at a bleed of 2 are both 255 pixels square, since 3 squares of
 * 85 and 5 squares of 51 are the same number. Those cannot be told apart
 * afterwards, so this steps past them to the next bleed that can, which costs one
 * more square of empty ground and nothing else.
 */
export function fittingBleed(
  footprintX: number,
  footprintZ: number,
  reachX: number,
  reachZ: number,
): number {
  const fx = Math.max(1, Math.trunc(footprintX));
  const fz = Math.max(1, Math.trunc(footprintZ));
  // Half the framed extent is (footprint / 2 + bleed) squares, so the bleed a
  // reach asks for is that much past half the footprint.
  const needed = Math.max(
    reachX / ELMOS_PER_BUILD_SQUARE - fx / 2,
    reachZ / ELMOS_PER_BUILD_SQUARE - fz / 2,
  );
  let bleed = Math.max(RENDER_BLEED_SQUARES, Math.ceil(needed));
  while (
    Math.max(fx, fz) + 2 * bleed <= MAX_FRAME_SQUARES &&
    bleedFromPixels(fx, fz, ...frameSize(fx, fz, bleed)) !== bleed
  ) {
    bleed += 1;
  }
  return bleed;
}

/** The pixel size of one candidate frame, as the pair {@link bleedFromPixels}
 *  matches on. */
function frameSize(
  footprintX: number,
  footprintZ: number,
  bleed: number,
): [number, number] {
  const frame = renderFrame(footprintX, footprintZ, bleed);
  return [frame.widthPx, frame.heightPx];
}

/**
 * Which bleed a top down render was taken with, from its own pixel size (issue
 * #2952).
 *
 * The consumer's half of {@link fittingBleed}. A plan is drawn over the ground
 * its building stands on plus the bleed round it, so a consumer that assumed the
 * floor of one square would draw a widened render at the wrong scale. Nothing
 * travels with the bytes to say, so the bleed is read back out of the picture: it
 * is the only unknown left once the footprint is known, since the footprint and
 * the bleed decide the pixel size between them.
 *
 * The narrowest match, which is what {@link fittingBleed} guarantees is the one
 * that was used. Null for a picture no frame produces, which is a render from
 * some other rule rather than a widened one.
 */
export function bleedFromPixels(
  footprintX: number,
  footprintZ: number,
  widthPx: number,
  heightPx: number,
): number | null {
  const fx = Math.max(1, Math.trunc(footprintX));
  const fz = Math.max(1, Math.trunc(footprintZ));
  for (
    let bleed = RENDER_BLEED_SQUARES;
    Math.max(fx, fz) + 2 * bleed <= MAX_FRAME_SQUARES;
    bleed += 1
  ) {
    const [width, height] = frameSize(fx, fz, bleed);
    if (width === widthPx && height === heightPx) return bleed;
  }
  return null;
}

/**
 * The pixel size a render of `angle` has to be, and the whole of what the two
 * sides have to agree on about framing (issue #1951).
 *
 * The twin of `render_pixels` in `crates/coilbox-assets`, which is what refuses a
 * render that is not this shape. The reasoning is written out there, since that
 * is the side the check runs on. In short: a plan keeps the footprint's aspect
 * because it tiles into a layout, and the other three are square because a front
 * or a side view has a footprint for its width and nothing at all for its
 * height, so they frame on the model instead.
 */
export function renderPixels(
  angle: string,
  footprintX: number,
  footprintZ: number,
  bleedSquares: number = RENDER_BLEED_SQUARES,
): { widthPx: number; heightPx: number } {
  if (angle === PLAN_ANGLE) {
    const { widthPx, heightPx } = renderFrame(
      footprintX,
      footprintZ,
      bleedSquares,
    );
    return { widthPx, heightPx };
  }
  const cap = ASSET_CLASSES[RENDER_CLASS].maxEdgePx ?? 0;
  return { widthPx: cap, heightPx: cap };
}
