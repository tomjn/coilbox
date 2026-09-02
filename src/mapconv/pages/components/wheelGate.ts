/**
 * Whether a wheel event over a 3D map preview should reach the page underneath
 * rather than being taken for a zoom (issue #2317).
 *
 * `MapPreview3D` copies `ModelViewport`'s trick of releasing the wheel when a
 * raycast at the pointer hits nothing, so scrolling past open sky reaches the
 * page rather than zooming into it. On the unit page that is most of the
 * canvas, so it is most of the fix. On a scenario map it is not: measured on
 * "Silence the Jericho" in the running app (`window.devicePixelRatio`-scaled
 * canvas readback, classifying pixels against the flat sky colour sampled off
 * the map), the sky share was 76.9% at the scenario's opening framed shot, 38.2%
 * at a normal working zoom, and 0.0% zoomed in far enough to place a unit
 * precisely. A raycast miss alone does nothing at that last, ordinary distance:
 * the map is everywhere the pointer could be.
 *
 * So a hit does not keep the wheel on its own. It only zooms once the view is
 * armed: clicked into since the pointer was last outside it. Armed drops the
 * moment the pointer leaves, so returning to the view after reading the rest of
 * the page always scrolls first and needs a fresh click to zoom again, and the
 * very first pass over a freshly opened page always scrolls.
 */
export function releaseWheel(hit: boolean, armed: boolean): boolean {
  return !hit || !armed;
}
