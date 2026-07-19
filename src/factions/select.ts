import type { FactionLogoSrc } from "./fallback";

/**
 * The size-aware faction-logo precedence, isolated from the resolver hook (which
 * pulls in Tauri command bindings) so it stays a pure, unit-testable function.
 */

/** Fallback display size assumed when a caller doesn't pass one (the common small
 * picker/dot size, at which a 16px sidepic is still pixel-perfect). */
export const DEFAULT_LOGO_SIZE = 16;

/** Already-resolved candidates for one side (each `undefined` when that layer had
 * nothing). Pure inputs so the precedence is testable in isolation. */
export interface LogoCandidates {
  /** Distribution-profile image (hard override). */
  profile?: string;
  /** Archive `Sidepics/<side>` emblem + its longest pixel side. */
  archive?: { src: string; maxDim: number };
  /** Branding-catalog image (curated, assumed large). */
  catalog?: string;
  /** Bundled Arm/Core fallback (vector). */
  fallback?: FactionLogoSrc;
}

/**
 * Pick a side's emblem by precedence, size-aware so nothing is upscaled into
 * pixelation. `displaySize` is the px the caller will render at; the archive
 * sidepic (typically 16px) sits at the top only when it's at least that big:
 *
 *   profile > archive if it fits (maxDim >= displaySize) > catalog >
 *   bundled vector (scales cleanly) > archive that would upscale > nothing
 *
 * So a 16px sidepic wins in a 16px picker but yields to the crisp vector emblem in
 * a 32px HUD tile, instead of rendering a blurry upscale.
 */
export function selectFactionLogo(
  c: LogoCandidates,
  displaySize: number = DEFAULT_LOGO_SIZE,
): FactionLogoSrc | undefined {
  if (c.profile) return { kind: "img", src: c.profile };
  // The game's own sidepic, but only if it won't be upscaled at this size.
  if (c.archive && c.archive.maxDim >= displaySize) {
    return { kind: "img", src: c.archive.src, maxDim: c.archive.maxDim };
  }
  if (c.catalog) return { kind: "img", src: c.catalog };
  // A vector emblem is crisp at any size — prefer it over upscaling a tiny sidepic.
  if (c.fallback) return c.fallback;
  // Last resort: a small raster that will upscale slightly, better than nothing.
  if (c.archive) {
    return { kind: "img", src: c.archive.src, maxDim: c.archive.maxDim };
  }
  return undefined;
}
