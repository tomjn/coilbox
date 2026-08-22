/**
 * How big coilbox draws its own interface.
 *
 * The webview has a zoom level and this is what exposes it. Zoom scales
 * everything the frame draws: text, spacing, icons and the 3D views alike, so a
 * small laptop screen can hold more and a large one can be read from further
 * away.
 *
 * The value lives in the frame settings store with the other display
 * preferences (`src/general/uiZoom.tsx` owns the hook and the settings control).
 * This module is the part with no React in it: the levels on offer, the maths
 * for stepping between them, and the one call that pushes a level at the
 * webview.
 *
 * ## Zoom and the 3D views
 *
 * A zoom of 1.5 makes a CSS pixel 1.5 device pixels wide, and the webview
 * reports that by multiplying `window.devicePixelRatio` (measured: 2 becomes 3
 * on a retina Mac at 150%). Everything laid out in CSS pixels therefore shrinks
 * by the same factor, so the physical size of a 3D view on the glass does not
 * change with zoom, only the number of CSS pixels it is described in.
 *
 * That is why {@link pixelRatioFor} caps the ratio against the display's own
 * scale rather than against the zoomed number. Capping the zoomed number at 2
 * would draw a 150% view into two thirds of the pixels it covers, which is the
 * blur this setting has to avoid. Capping the unzoomed one keeps the drawing
 * buffer the same size in device pixels whatever the zoom, which is both sharp
 * and no more work for the GPU than 100% was.
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";

/** The settings-store key. Shares the `display.` namespace with the rest. */
export const UI_ZOOM_KEY = "display.uiZoom";

/** No zoom: one CSS pixel per display pixel. */
export const DEFAULT_UI_ZOOM = 1;

/**
 * The levels the setting offers, smallest first.
 *
 * Bounded at half size and double size on purpose. Zoom is the one setting that
 * can hide the control that undoes it, and within these bounds the settings
 * screen stays both readable and reachable, so there is no state to have to
 * escape from. Browsers land on much the same set.
 */
export const UI_ZOOM_LEVELS: readonly number[] = [
  0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
];

/**
 * The offered level nearest `zoom`.
 *
 * Anything outside the range comes back as the nearest bound, so a value typed
 * into the settings file by hand cannot leave the app at a size it does not
 * offer a way back from. A snapped value also means {@link stepUiZoom} always
 * has somewhere to step from.
 */
export function clampUiZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_UI_ZOOM;
  let nearest = UI_ZOOM_LEVELS[0];
  for (const level of UI_ZOOM_LEVELS) {
    if (Math.abs(level - zoom) < Math.abs(nearest - zoom)) nearest = level;
  }
  return nearest;
}

/**
 * One level up (`1`) or down (`-1`) from `zoom`, stopping at the ends.
 *
 * `zoom` is snapped first, so stepping from an unlisted value moves off the
 * nearest listed one rather than doing nothing.
 */
export function stepUiZoom(zoom: number, direction: 1 | -1): number {
  const from = UI_ZOOM_LEVELS.indexOf(clampUiZoom(zoom));
  const next = Math.min(
    UI_ZOOM_LEVELS.length - 1,
    Math.max(0, from + direction),
  );
  return UI_ZOOM_LEVELS[next];
}

/**
 * The pixel ratio a 3D view should draw at, given what the webview reports and
 * the zoom that is folded into it.
 *
 * `cap` limits the display's own scale factor, not the zoomed one: a retina Mac
 * at 200% reports a ratio of 4, and the answer is 4 rather than the cap,
 * because the view it is drawing is half as many CSS pixels across. The device
 * pixels come out the same either way, which is what a cap is for.
 */
export function pixelRatioFor(
  devicePixelRatio: number,
  zoom: number,
  cap = 2,
): number {
  return Math.min(devicePixelRatio / zoom, cap) * zoom;
}

let current: number = DEFAULT_UI_ZOOM;

/** The zoom level currently pushed at the webview. */
export function uiZoom(): number {
  return current;
}

/**
 * The pixel ratio for a 3D view drawing right now. See {@link pixelRatioFor}.
 */
export function drawingPixelRatio(cap = 2): number {
  return pixelRatioFor(window.devicePixelRatio, current, cap);
}

/**
 * Push `zoom` at the webview and remember it, snapped to an offered level.
 *
 * Best-effort, like the fullscreen apply next to it: a webview that refuses a
 * zoom must not take startup or a settings change down with it.
 */
export function applyUiZoom(zoom: number): void {
  current = clampUiZoom(zoom);
  getCurrentWebview()
    .setZoom(current)
    .catch((e) => console.warn("uiZoom: setZoom failed", e));
}
