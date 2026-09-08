/**
 * Packaging a project as a `.sdz` file somebody else can play (issue #1283).
 *
 * The local test route (`mutator.ts`) writes into a fixed folder on purpose,
 * so testing a project twice reuses one folder and deleting it undoes
 * everything that route ever wrote. A file handed to somebody else is the
 * opposite: it needs a name the author chose, which the project's own name
 * already is, and a version that changes, because two people playing
 * different builds of the same archive name is a sync error rather than an
 * error message. `workshop_package_mutator` renders `modinfo.lua` a second
 * time with the version this export is being published as, checks the result
 * the same way `workshop_test_mutator` does, and zips it to the path the save
 * dialog picked.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import type { ModProject } from "./project";

/** What `workshop_package_mutator` wrote. */
export interface PackagedMutatorResult {
  /** Where the archive was written, absolute. */
  path: string;
  /** Every file the archive holds, relative to its own root. */
  files: string[];
  /** The version written into `modinfo.lua`. */
  version: number;
}

/**
 * Compile a project, check it, and pack it as a `.sdz` at `dest`. Rejects the
 * same way `workshopTestMutator` does when there is nothing to package, and
 * rejects again when preflight finds a blocker: a file going out to other
 * people is exactly the case a blocker should stop rather than only flag.
 */
export const workshopPackageMutator = defineCommand<
  { project: ModProject; version: number; dest: string },
  PackagedMutatorResult
>("coilbox-workshop", "workshop_package_mutator");

/**
 * A file name for a packaged archive, from the project's own name and the
 * version being published. Matches `modProjectFileName`'s slugging in
 * `project.ts`, so the two exports read as the same family of file.
 */
export function packagedMutatorFileName(
  project: ModProject,
  version: number,
): string {
  const slug =
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tweak-project";
  return `${slug}-v${version}.sdz`;
}
