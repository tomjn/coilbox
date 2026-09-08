/**
 * The workshop's own local test mutator, over `workshop_test_mutator`
 * (issue #1278).
 *
 * A compiled project is already the shape of any other mutator archive
 * (`compile.ts`'s own doc comment): a `modinfo.lua` depending on the base
 * game plus whatever it changes. Writing it under the content root's
 * `games/` is what lets the engine launch it, the same move
 * `src/scenario/mutator.ts` makes for a scenario under test.
 *
 * The folder is fixed and coilbox's own (`WORKSHOP_MUTATOR_FOLDER` in
 * `src/lib/generatedGames.ts`), so testing a project twice reuses one folder
 * rather than leaving a trail, and deleting it undoes everything this route
 * ever wrote.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import type { ModProject } from "./project";

/** What `workshop_test_mutator` wrote. */
export interface TestMutatorResult {
  /** The mutator's folder, absolute. */
  dir: string;
  /** The mutator's folder name, matching `WORKSHOP_MUTATOR_FOLDER`. */
  folder: string;
  /** Every file written, relative to `dir`. */
  files: string[];
}

/**
 * Compile a project and write it into coilbox's own test game under
 * `dataDir`. Rejects when the project has no edits a mutator archive can
 * carry, since there would be nothing to test.
 */
export const workshopTestMutator = defineCommand<
  { dataDir: string; project: ModProject },
  TestMutatorResult
>("coilbox-workshop", "workshop_test_mutator");
