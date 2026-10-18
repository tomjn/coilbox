/**
 * Writing the locked list into a game folder beside the exported units
 * (#3289). The text and the path come from `locks.ts`. This puts them on disk
 * with the one write command the builder already has.
 */

import { legoReadTextFile, legoWriteTextFile } from "./bindings";
import { lockedListPath, lockedListText, lockedUnitNames } from "./locks";
import type { LegoProject } from "./model";

/**
 * Write the list of `project`'s locked units under `dir`, and answer the path
 * written. With nothing locked it writes only to empty a list written before, so
 * a game folder never gains a file for a unit that has no locks. Throws with the
 * reason when the file cannot be written.
 */
export async function writeLockedList(
  dir: string,
  project: LegoProject,
): Promise<string | null> {
  const path = `${dir.replace(/[\\/]+$/, "")}/${lockedListPath(project)}`;
  if (lockedUnitNames(project).length === 0) {
    try {
      await legoReadTextFile({ path });
    } catch {
      return null;
    }
  }
  await legoWriteTextFile({ path, text: lockedListText(project) });
  return path;
}
