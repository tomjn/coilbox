/**
 * Packaging a project as a `.sdz` file somebody else can play (issue #1283),
 * or as an unpacked `.sdd` folder for somebody who keeps their game as a
 * loose directory under version control instead (issue #3160).
 *
 * The local test route (`mutator.ts`) writes into a fixed folder on purpose,
 * so testing a project twice reuses one folder and deleting it undoes
 * everything that route ever wrote. A file or folder handed to somebody else
 * is the opposite: it needs a name the author chose, which the project's own
 * name already is, and a version that changes, because two people playing
 * different builds of the same archive name is a sync error rather than an
 * error message. `workshop_package_mutator` renders `modinfo.lua` a second
 * time with the version this export is being published as, checks the result
 * the same way `workshop_test_mutator` does, and writes it to the path the
 * save (or folder) dialog picked, zipped or as a plain directory depending on
 * `format`.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import type { Written } from "./loadsAs";
import type { ModProject } from "./project";

/** What `workshop_package_mutator` wrote. */
export interface PackagedMutatorResult {
  /** Where the archive (or folder) was written, absolute. */
  path: string;
  /** Every file the archive holds, relative to its own root. */
  files: string[];
  /** The version written into `modinfo.lua`. */
  version: number;
}

/**
 * Compile a project, check it, and pack it at `dest`, as a `.sdz` archive
 * (`format` omitted or `"sdz"`) or an unpacked `.sdd` folder (`format:
 * "sdd"`). Rejects the same way `workshopTestMutator` does when there is
 * nothing to package, and rejects again when preflight finds a blocker: a
 * file going out to other people is exactly the case a blocker should stop
 * rather than only flag.
 *
 * `overwrite` only matters for `"sdd"`: an existing folder at `dest` is left
 * untouched unless it is set, since unlike the fixed folder the local test
 * route owns, this destination is one the caller chose and might already
 * hold something unrelated. The `.sdz` route needs no such flag: the save
 * dialog already confirmed a replace with the author before this command
 * ever runs.
 */
export const workshopPackageMutator = defineCommand<
  {
    project: ModProject;
    version: number;
    dest: string;
    format?: "sdz" | "sdd";
    overwrite?: boolean;
    written?: Written;
  },
  PackagedMutatorResult
>("coilbox-workshop", "workshop_package_mutator");

/**
 * A slug from the project's own name, shared by every packaged file name so
 * an archive and its unpacked folder land on the same base name. Matches
 * `modProjectFileName`'s slugging in `project.ts`.
 */
function packagedSlug(project: ModProject): string {
  return (
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tweak-project"
  );
}

/**
 * A file name for a packaged archive, from the project's own name and the
 * version being published.
 */
export function packagedMutatorFileName(
  project: ModProject,
  version: number,
): string {
  return `${packagedSlug(project)}-v${version}.sdz`;
}

/**
 * A folder name for an unpacked export (issue #3160), the same base name
 * `packagedMutatorFileName` gives the zipped archive but ending in `.sdd`,
 * the extension the engine expects a loose game directory to carry.
 */
export function packagedSddFolderName(
  project: ModProject,
  version: number,
): string {
  return `${packagedSlug(project)}-v${version}.sdd`;
}
