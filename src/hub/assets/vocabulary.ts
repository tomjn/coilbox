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
   * {@link maxObjectBytes}, and `overlay:height` gets a per-upload number out of
   * the map's own size, which is {@link heightOverlayMaxBytes}.
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
  heightOverlay: {
    elmosPerSample: number;
    bytesPerSample: number;
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
 * The angles worth rendering, which is one.
 *
 * `render:top` exists for the hub's blueprint preview and nothing else asks for
 * another. Renders are the only class in the corpus that scales without a natural
 * bound, so an angle added on spec is a real cost rather than a spare column.
 */
export const RENDER_ANGLES = vocabulary.unit.renderAngles;

/**
 * The map side of the vocabulary, and a closed list, unlike the unit side. None
 * of the four is open ended the way a render angle is, so a typo mints an
 * identity nothing ever asks for.
 */
export const MAP_VARIANTS = vocabulary.mapVariants;

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

/** How many elmos one heightmap sample spans, the engine's `squareSize`. */
export const ELMOS_PER_HEIGHT_SAMPLE = vocabulary.heightOverlay.elmosPerSample;

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
 * How many samples a height overlay carries along an edge that many elmos long.
 * One per heightmap vertex, so there is a fencepost more than there are squares.
 */
export function heightOverlaySamples(elmos: number): number {
  return Math.floor(elmos / ELMOS_PER_HEIGHT_SAMPLE) + 1;
}

/**
 * The largest a height overlay for a map this size may be (coilbox-hub#142), and
 * null for every other class. Two bytes a sample, because the layer is 16 bit
 * grayscale rather than the four bytes a colour image takes.
 */
export function heightOverlayMaxBytes(
  variant: string,
  mapWidthElmos: number,
  mapHeightElmos: number,
): number | null {
  if (variant !== "overlay:height") return null;
  return (
    heightOverlaySamples(mapWidthElmos) *
    heightOverlaySamples(mapHeightElmos) *
    vocabulary.heightOverlay.bytesPerSample
  );
}

/**
 * The bleed a render carries on each side, in whole build squares.
 *
 * Models overhang their footprints, so a render framed exactly on the footprint
 * clips them. A clipped radar dish reads as broken and a centred one does not, so
 * the frame is widened by a whole square on every side and the consumer adds it
 * back, which it can because it knows the footprint too.
 */
export const RENDER_BLEED_SQUARES = vocabulary.renderFrame.bleedSquares;

/** Elmos per build square: two of the engine's `SQUARE_SIZE`, the same 16 that
 * `src/lego/unitDef.ts` uses. */
export const ELMOS_PER_BUILD_SQUARE =
  vocabulary.renderFrame.elmosPerBuildSquare;

/** The frame one unit's top down render is taken in. */
export interface RenderFrame {
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
 * at 1.
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
): RenderFrame {
  const squaresX =
    Math.max(1, Math.trunc(footprintX)) + 2 * RENDER_BLEED_SQUARES;
  const squaresZ =
    Math.max(1, Math.trunc(footprintZ)) + 2 * RENDER_BLEED_SQUARES;

  const cap = ASSET_CLASSES[RENDER_CLASS].maxEdgePx ?? 0;
  const pixelsPerSquare = Math.max(
    1,
    Math.floor(cap / Math.max(squaresX, squaresZ)),
  );

  return {
    squaresX,
    squaresZ,
    widthElmos: squaresX * ELMOS_PER_BUILD_SQUARE,
    heightElmos: squaresZ * ELMOS_PER_BUILD_SQUARE,
    widthPx: squaresX * pixelsPerSquare,
    heightPx: squaresZ * pixelsPerSquare,
    pixelsPerSquare,
  };
}
