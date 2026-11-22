/**
 * Whether a drag snaps: the Snapping item in the Show menu is on and Alt is
 * not held. Alt frees one drag, the menu item frees them all.
 */
export function snappingActive(enabled: boolean, altHeld: boolean): boolean {
  return enabled && !altHeld;
}

/**
 * Whether the selected piece's snap points are drawn. They are only useful
 * while a piece is being moved with snapping on, and they cover the model the
 * rest of the time.
 */
export function snapAnchorsShown(
  snapEnabled: boolean,
  movingPiece: boolean,
): boolean {
  return snapEnabled && movingPiece;
}
