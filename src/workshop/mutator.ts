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
import type { Written } from "./loadsAs";
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
  {
    dataDir: string;
    project: ModProject;
    written?: Written;
    /** As `workshopCompile` takes it (issue #3177). */
    baseCopies?: string[];
  },
  TestMutatorResult
>("coilbox-workshop", "workshop_test_mutator");

/**
 * Put a generated mission into the same test game, and the mission runtime
 * where the base game lacks it (issue #3178). The mutator route calls it
 * after `workshopTestMutator` and passes no `modinfo`. The tweak slot route
 * has no compiled files, so it passes the `modinfo` and the folder is
 * cleared first, which is what keeps it free of any `gamedata/`.
 */
export const workshopTestMission = defineCommand<
  {
    dataDir: string;
    missionId: string;
    mission: string;
    modinfo?: string;
    /** False for a base game that already bundles a new enough runtime. */
    shipRuntime: boolean;
  },
  TestMutatorResult
>("coilbox-workshop", "workshop_test_mission");
