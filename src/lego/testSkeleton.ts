/**
 * What Test in game does for the skeleton widget (issue #5182).
 *
 * Before the engine starts, the widget is installed or updated in the content
 * root, and the scratch game's skeleton file is written with the unit's body
 * plan and a `coilbox_test_unit` entry naming the unit. The widget
 * (`lua/skeleton-widget/luaui/coilbox_skeleton/testunit.lua`) selects the
 * player's unit of that definition when it first exists and shows its bones.
 *
 * The entry holds the unit definition's name, as the keys of `units` do. A unit
 * with no skeleton still gets the entry. The widget then draws the bones the
 * engine gives it from the model, without role labels.
 */

import { appFileIO } from "@/blueprint/fileIO";
import type { BlueprintFileIO } from "@/blueprint/gameFile";
import {
  type ConfigOption,
  contentWidgetInstall,
  contentWidgetStatus,
  type WidgetStatus,
} from "@/content/bindings";
import { primeGameInfo } from "@/content/config";
import { describeError } from "@/i18n/uiError";
import { withUserWidgets } from "@/play/userWidgets";
import type { LegoProject } from "./model";
import { SCRATCH_SHORTNAME } from "./scratchGame";
import {
  mergeSkeleton,
  skeletonFilePath,
  unitSkeletonEntry,
  writeSkeletonFiles,
} from "./skeletonFile";

/** The top level key of the skeleton file that names the test unit. */
export const TEST_UNIT_KEY = "coilbox_test_unit";

/**
 * The scratch game's skeleton file with the test unit named. The unit's entry
 * is dropped when it has no skeleton, so a plan from an earlier test of the
 * same name does not label a unit that no longer has one. Everything else in
 * the file is kept. Throws for text that is not a skeleton file.
 */
export function nameTestUnit(
  existing: string | null,
  unitName: string,
  hasSkeleton: boolean,
): string {
  const file = JSON.parse(mergeSkeleton(existing, {}).text) as Record<
    string,
    unknown
  > & { units: Record<string, unknown> };
  if (!hasSkeleton) delete file.units[unitName];
  file[TEST_UNIT_KEY] = unitName;
  return JSON.stringify(file, null, 2);
}

export interface TestSkeletonArgs {
  target: { enginePath: string; dataDir: string };
  /** The archive of the game the scratch game builds on, whose options apply. */
  baseArchive: string;
  project: LegoProject;
  /** The mod options the launch already has. */
  modOptions: Record<string, string>;
}

export interface TestSkeletonResult {
  /** The launch's mod options, with `allowuserwidgets` on when the widget is
   *  installed and the game ships it off. */
  modOptions: Record<string, string>;
  /** What went wrong, for the drawer to show. The launch goes ahead anyway. */
  problem: string | null;
}

/** What the widget commands are, so a test can stand in for the app. */
export interface TestSkeletonDeps {
  io: BlueprintFileIO;
  widgetStatus: (args: {
    rootPath: string;
    widget: "skeleton";
  }) => Promise<WidgetStatus>;
  widgetInstall: (args: {
    rootPath: string;
    widget: "skeleton";
  }) => Promise<unknown>;
  /** The game's options, from its own option list. */
  gameOptions: (
    enginePath: string,
    dataDir: string,
    archive: string,
  ) => Promise<ConfigOption[]>;
}

const appDeps: TestSkeletonDeps = {
  io: appFileIO,
  widgetStatus: contentWidgetStatus,
  widgetInstall: contentWidgetInstall,
  gameOptions: async (enginePath, dataDir, archive) =>
    (await primeGameInfo(enginePath, dataDir, archive)).options,
};

/**
 * Install or update the skeleton widget in the content root when it is not
 * current, write the scratch game's skeleton file for the unit, and turn on the
 * game's `allowuserwidgets` option when it ships it off, so the widget loads.
 * Never throws: a launch does not wait on a bones overlay, so a failure comes
 * back as `problem` and the mod options come back as they were given.
 */
export async function prepareTestSkeleton(
  { target, baseArchive, project, modOptions }: TestSkeletonArgs,
  deps: TestSkeletonDeps = appDeps,
): Promise<TestSkeletonResult> {
  const root = target.dataDir;
  const problems: string[] = [];
  let widgetReady = false;
  try {
    const args = { rootPath: root, widget: "skeleton" } as const;
    const status = await deps.widgetStatus(args);
    if (!status.current) await deps.widgetInstall(args);
    widgetReady = true;
  } catch (error) {
    problems.push(describeError(error));
  }
  try {
    // The plan goes under the unit's own game and under the scratch game, whose
    // short name is the one the match reports. Then the scratch game's file
    // names the unit to select.
    await writeSkeletonFiles(deps.io, root, [project], {
      alsoUnder: SCRATCH_SHORTNAME,
    });
    const path = skeletonFilePath(root, SCRATCH_SHORTNAME);
    await deps.io.write(
      path,
      nameTestUnit(
        await deps.io.read(path),
        project.unitName,
        unitSkeletonEntry(project) !== null,
      ),
    );
  } catch (error) {
    problems.push(describeError(error));
  }
  let options: ConfigOption[] = [];
  if (widgetReady) {
    try {
      options = await deps.gameOptions(target.enginePath, root, baseArchive);
    } catch {
      // With no option list nothing is turned on. The widget still loads in a
      // game that loads user widgets by default.
    }
  }
  return {
    modOptions: withUserWidgets(modOptions, options, widgetReady),
    problem: problems.length ? problems.join(" ") : null,
  };
}
