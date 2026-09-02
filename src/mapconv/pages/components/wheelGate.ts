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

/**
 * Approximate stand-in for "is the pointer over the map" (issue #2326).
 *
 * The first version of this gate answered that with
 * `raycaster.intersectObjects(scene.children, true)` against the actual
 * terrain: a 512-segment plane, 524,288 triangles, with no BVH. Measured at
 * 341ms per wheel event, which read as stuttering and as a fast trackpad sweep
 * both scrolling and zooming at once.
 *
 * Nobody can tell whether a release happened one pixel inside the map's edge
 * or one pixel outside, so the terrain's actual displaced surface is not
 * needed here. The map is a flat rectangle in the XZ plane, so this intersects
 * the ray with a single horizontal plane at the map's mid height and checks
 * the point lands inside the map's footprint. Constant time, no allocation,
 * no scene traversal.
 *
 * Two situations never divide against a near-zero denominator or trust a
 * negative distance:
 * - A ray parallel to the plane (looking dead level, `direction.y` ~ 0) never
 *   crosses it, so this reports a miss, same as sky.
 * - A crossing behind the camera (`t < 0`) is not what is on screen, so this
 *   also reports a miss.
 *
 * A shallow-angle ray that crosses the plane outside the map's bounds, sky
 * beyond the horizon, reports a miss the same way, by the bounds check below.
 */
export function groundHit(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  groundY: number,
  halfWidth: number,
  halfDepth: number,
): boolean {
  if (Math.abs(direction.y) < 1e-6) return false; // parallel to the plane
  const t = (groundY - origin.y) / direction.y;
  if (t < 0) return false; // the plane is behind the camera
  const x = origin.x + direction.x * t;
  const z = origin.z + direction.z * t;
  return Math.abs(x) <= halfWidth && Math.abs(z) <= halfDepth;
}
