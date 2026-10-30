/**
 * Reads what the battle room's warning about player widgets needs from the
 * machine (issue #1292): the game's handler, the widget files, and the two
 * config files whose entries can turn the widgets off.
 */

import { appFileIO } from "@/blueprint/fileIO";
import { type GameItem, unitsyncEngineConfig } from "@/content/bindings";
import { engineConfigDir } from "@/content/enginePaths";
import { handlerOf } from "./gameHandler";
import type { UserWidgetGates } from "./handlers";
import { findConfig, readFlag, readLocalWidgets } from "./widgetConfig";
import { type GameHandler, type WidgetRow, widgetRows } from "./widgetList";
import { scanWidgets } from "./widgetRoots";

export interface RoomWidgets {
  game: GameHandler;
  rules: UserWidgetGates;
  rows: WidgetRow[];
  /** See {@link import("./roomWarning").RoomWidgetContext}. */
  configFlag: boolean | null;
  localWidgets: boolean | null;
}

/** `read` of a file, or null when the file is there and cannot be read, so a
 *  file coilbox does not understand never produces a warning. */
async function tryRead<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    console.warn("could not read a widget config file", e);
    return null;
  }
}

/**
 * The player's widgets and the settings that gate them for `game`, or null
 * when its handler is not recognised or checks nothing, so there is nothing to
 * warn about.
 */
export async function loadRoomWidgets({
  enginePath,
  dataDir,
  game,
}: {
  enginePath: string;
  dataDir: string;
  game: GameItem;
}): Promise<RoomWidgets | null> {
  const handler = await handlerOf(enginePath, dataDir, game);
  const rules = handler?.userWidgets;
  if (!handler || !rules) return null;
  const engineConfig = await unitsyncEngineConfig({ enginePath, dataDir });
  const writeDir = engineConfigDir(engineConfig.configPath);
  if (!writeDir) return null;
  const entry: GameHandler = {
    game: game.name,
    shortName: game.info.shortname?.trim() || undefined,
    handler,
  };
  // The widgets are under every content root, and the config files are in the
  // engine's write folder (issues #4856, #4861).
  const scan = await scanWidgets(dataDir);
  const short = entry.shortName ?? "";

  let configFlag: boolean | null = null;
  if (rules.configFlag) {
    configFlag = await tryRead(async () => {
      const found = await findConfig(
        appFileIO,
        writeDir,
        handler.config,
        short,
      );
      return found ? readFlag(found.text, "allowUserWidgets") : null;
    });
  }
  let localWidgets: boolean | null = null;
  const localFile = rules.localWidgetsFile;
  if (localFile) {
    localWidgets = await tryRead(async () => {
      const found = await findConfig(
        appFileIO,
        writeDir,
        { dir: handler.config.dir, files: [localFile], shape: "flat" },
        short,
      );
      // A game that has not saved the file yet has not had local widgets
      // turned on.
      return found ? readLocalWidgets(found.text) : false;
    });
  }
  return {
    game: entry,
    rules,
    rows: widgetRows(scan, [entry]),
    configFlag,
    localWidgets,
  };
}
