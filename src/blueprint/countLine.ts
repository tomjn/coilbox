/**
 * What a blueprint holds, in a line for its card (issue #4790).
 *
 * Buildings first, then terrain changes when there are any: "5 buildings", "5
 * buildings, 3 terrain changes", "No buildings, 3 terrain changes". A layout
 * with neither is "0 buildings", as it always was. Every card, row and header
 * that counts a layout says it through this, so none of them can forget the
 * terrain.
 */

import { plural, t } from "@lingui/core/macro";

export function countLine(buildings: number, terrain: number): string {
  const built =
    buildings === 0 && terrain > 0
      ? t`No buildings`
      : plural(buildings, { one: "# building", other: "# buildings" });
  if (terrain === 0) return built;
  const changes = plural(terrain, {
    one: "# terrain change",
    other: "# terrain changes",
  });
  return t`${built}, ${changes}`;
}
