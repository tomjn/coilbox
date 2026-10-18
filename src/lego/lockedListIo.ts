/**
 * Writing the locked list into a game folder beside the exported units
 * (#3289). The text and the path come from `locks.ts`. This puts them on disk
 * with the one write command the builder already has.
 *
 * The list is named after the chassis, so a rename would leave the old one
 * behind (#2680). The export receipt records every list it writes with the
 * digest of the text. When a later export writes under a new name, an old list
 * whose contents still match its digest is coilbox's own and is emptied, so a
 * mission reading it finds no locked units. It is emptied and not deleted
 * because the builder has no command to delete a file, and the leftovers
 * removal in the export drawer only knows the paths of a unit's own files. A
 * list that no longer matches was edited by hand and is left alone and named.
 */

import { legoReadTextFile, legoWriteTextFile } from "./bindings";
import { comparablePath } from "./exportRecord";
import {
  EMPTY_LOCKED_LIST,
  lockedListPath,
  lockedListText,
  lockedUnitNames,
} from "./locks";
import type { ExportedFile, LegoProject } from "./model";

/** What writing the list did. */
export interface LockedListWrite {
  /** The list written, for the receipt. Null when there was nothing to write. */
  file: ExportedFile | null;
  /** Lists written under an earlier chassis name, emptied now. */
  emptied: string[];
  /** Lists under an earlier name that are not what coilbox wrote, left alone. */
  kept: string[];
}

const LISTS = "/luarules/configs/coilbox_locked_units/";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Write the list of `project`'s locked units under `dir`. With nothing locked
 * it writes only to empty a list written before, so a game folder never gains a
 * file for a unit that has no locks. `previous` is the files the folder's
 * receipt holds, which is how a list under an old name is found. Throws with the
 * reason when the list cannot be written.
 */
export async function writeLockedList(
  dir: string,
  project: LegoProject,
  previous: readonly ExportedFile[] = [],
): Promise<LockedListWrite> {
  const path = `${dir.replace(/[/]+$/, "")}/${lockedListPath(project)}`;
  const result: LockedListWrite = { file: null, emptied: [], kept: [] };
  const text = lockedListText(project);
  const nothing = lockedUnitNames(project).length === 0;
  let write = !nothing;
  if (nothing) {
    try {
      await legoReadTextFile({ path });
      write = true;
    } catch {
      write = false;
    }
  }
  if (write) {
    await legoWriteTextFile({ path, text });
    result.file = { path, sha256: await sha256(text) };
  }

  const empty = EMPTY_LOCKED_LIST;
  for (const old of previous) {
    const wasList = comparablePath(old.path).includes(LISTS);
    if (!wasList || comparablePath(old.path) === comparablePath(path)) continue;
    let onDisk: string;
    try {
      onDisk = (await legoReadTextFile({ path: old.path })).text;
    } catch {
      continue;
    }
    if (onDisk === empty) continue;
    if ((await sha256(onDisk)) !== old.sha256) {
      result.kept.push(old.path);
      continue;
    }
    await legoWriteTextFile({ path: old.path, text: empty });
    result.emptied.push(old.path);
  }
  return result;
}
