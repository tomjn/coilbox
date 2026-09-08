/**
 * What a project remembers about the game folders it has been exported into,
 * and what a rename does to it (issue #2680).
 *
 * Export writes files named after the unit's export name: `objects3d/<n>.s3o`,
 * `scripts/<n>.lua`, `scripts/coilbox/<n>_collision.lua`, `units/<n>.lua` and
 * the three Blender files. Rename the unit and export again and the first set
 * stays exactly where it was, so the game now has two units. The second one is
 * broken as often as not, since a definition whose `objectname` no longer
 * resolves is dropped by `gamedata/unitdefs.lua` before the game sees it.
 *
 * The old name is the whole problem. The receipt is overwritten by the new
 * export, and after that nothing in coilbox knows what the unit used to be
 * called, so nothing can say what is still in the folder. So the receipt about
 * to be replaced is moved aside rather than dropped, and the export drawer reads
 * the list.
 *
 * Nothing here deletes anything. A game folder is the user's, and two units
 * under two names is occasionally what somebody wanted, so the choice is theirs
 * to make in the drawer. What this makes possible is that the choice exists at
 * all, and that the files coilbox offers to take away are ones it can prove it
 * wrote: each carries the digest of the bytes written, and the removal checks
 * the file on disk against it.
 *
 * Only a rename inside one folder. Exporting into a second game leaves the first
 * game's copy alone, because that is an install somebody asked for rather than
 * something a rename left behind.
 */
import type {
  ExportedFile,
  LegoExport,
  LegoProject,
  StaleExport,
} from "./model";

/**
 * One path as it compares to another.
 *
 * Separators go one way and a trailing one is dropped, because the export's
 * folder picker and unitsync's own path are two different pieces of software
 * describing one directory and neither promises the other's spelling. Case is
 * folded for the same reason, which is wrong on a case-sensitive filesystem
 * holding two folders whose names differ only in case: a real possibility, and
 * a far smaller one than the export silently never being found on macOS or
 * Windows, where the user typed one case and the scan reported the other.
 */
export function comparablePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Whether two paths name one folder. */
export function samePath(a: string, b: string): boolean {
  return comparablePath(a) === comparablePath(b);
}

/** The digests a cleanup checks a file against, deduplicated. */
export function digestsOf(files: ExportedFile[]): string[] {
  return [...new Set(files.map((file) => file.sha256))];
}

/**
 * Every file coilbox has written to each path, newest first per path.
 *
 * Merged rather than replaced because the export writes the script and the
 * definition once and then leaves them alone: a second export under the same
 * name keeps both, writes neither, and would otherwise drop the proof that
 * coilbox wrote them in the first place.
 */
function mergeFiles(
  previous: ExportedFile[],
  written: ExportedFile[],
): ExportedFile[] {
  const kept = previous.filter(
    (file) => !written.some((now) => now.path === file.path),
  );
  return [...written, ...kept];
}

/** What one export does to a project's record of where it has been. */
export interface ExportRecord {
  exported: LegoExport;
  staleExports: StaleExport[];
}

/**
 * The receipt and the leftovers after an export, given what the project held
 * before it.
 *
 * `written` is the files this run actually put on disk, from the Rust half.
 */
export function recordExport(
  project: Pick<LegoProject, "exported" | "staleExports">,
  next: Omit<LegoExport, "files">,
  written: ExportedFile[],
): ExportRecord {
  const previous = project.exported;
  const sameTarget =
    previous !== undefined &&
    samePath(previous.dir, next.dir) &&
    previous.unitName === next.unitName;

  const exported: LegoExport = {
    ...next,
    files: mergeFiles(sameTarget ? previous.files : [], written),
  };

  // The name that has just been exported is not stale, whatever it was before.
  // Renaming back to a name still sitting in the folder is a real way out of
  // this, and it must clear the entry rather than leave the drawer offering to
  // delete the unit that was just written.
  let staleExports = (project.staleExports ?? []).filter(
    (stale) =>
      !(samePath(stale.dir, next.dir) && stale.unitName === next.unitName),
  );

  if (previous && !sameTarget && samePath(previous.dir, next.dir)) {
    staleExports = [
      ...staleExports.filter((stale) => stale.unitName !== previous.unitName),
      {
        dir: previous.dir,
        at: previous.at,
        unitName: previous.unitName,
        files: previous.files,
      },
    ];
  }

  return { exported, staleExports };
}

/** Drop one name from the leftovers, once its files are gone. */
export function forgetStale(
  staleExports: StaleExport[],
  stale: StaleExport,
): StaleExport[] {
  return staleExports.filter(
    (entry) =>
      !(samePath(entry.dir, stale.dir) && entry.unitName === stale.unitName),
  );
}
