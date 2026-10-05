/**
 * Which location a pointer picks on the strategic map, once the raycast has
 * been done. Pure, so the rule that fog hides a location from the pointer is
 * tested without a scene.
 */

/** The part of the province layer picking reads. */
export interface ProvincePicker {
  /** True when the node at this index is drawn as an area. */
  isProvince: (nodeIndex: number) => boolean;
  /** Node index of the province under the pointer, or -1. */
  pick: () => number;
}

/**
 * The node index the pointer picks, or -1 for none.
 *
 * `coreHit` is the node whose hit target the pointer is over, or -1. A point
 * location is picked by its hit target. A province is picked by its whole
 * area, so its anchor's hit target is ignored and the ground under the
 * pointer decides. A point location standing inside a province keeps its own
 * hit target and wins.
 *
 * A location `isHidden` names is never picked, and neither is whatever lies
 * under it: a hidden city standing in a visible province picks nothing. The
 * view names the locations hidden by fog and the ones it was told are inert,
 * such as the scenery of a run.
 */
export function pickLocation(
  coreHit: number,
  provinces: ProvincePicker | undefined,
  isHidden: (nodeIndex: number) => boolean,
): number {
  let index = coreHit;
  if (provinces && (index < 0 || provinces.isProvince(index))) {
    index = provinces.pick();
  }
  return index >= 0 && isHidden(index) ? -1 : index;
}
