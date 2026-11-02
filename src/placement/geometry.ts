/**
 * A position on the map's ground plane, in engine world units. There is no `y`:
 * everything a scenario places sits on the terrain, so the runtime reads the
 * ground height at spawn time and the editor never has to store a height that
 * could drift from the map.
 */
export type Point = { x: number; z: number };

/**
 * Which way a placed unit faces, as the engine's `Spring.CreateUnit` facing:
 * 0 south, 1 east, 2 north, 3 west. Buildings snap to these four, so scenarios
 * use them for everything rather than carrying two rotation conventions.
 */
export type Facing = 0 | 1 | 2 | 3;
