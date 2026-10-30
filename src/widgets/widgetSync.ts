/**
 * Reading a game's config file into the widget sets, and writing the set that
 * applies back into it before a launch (issue #4844).
 */

import { appFileIO } from "@/blueprint/fileIO";
import { unitsyncEngineConfig } from "@/content/bindings";
import { primeScan } from "@/content/config";
import { engineConfigDir } from "@/content/enginePaths";
import { errorText } from "@/lib/helpers";
import { handlerOf, newConfigText } from "./gameHandler";
import {
  type ConfigFileIO,
  findConfig,
  readOrder,
  writeWidgetStates,
} from "./widgetConfig";
import { type GameHandler, type WidgetRow, widgetRows } from "./widgetList";
import { scanWidgets } from "./widgetRoots";
import {
  absorbFile,
  addWidgets,
  gameWidgets,
  readSets,
  recordWrite,
  setKey,
  statesToWrite,
  switchOff,
  updateSets,
} from "./widgetSets";

/** What reading one game's config file found. */
export type GameFile =
  /** The game has not saved one yet. */
  | { kind: "missing" }
  /** `order` is its order table, by widget name. */
  | { kind: "ready"; path: string; order: ReadonlyMap<string, number> }
  /** It is there and could not be read. */
  | { kind: "error"; error: string };

/** Read one game's config file and take any change made outside coilbox into
 *  the set it uses. Throws when the file is there and cannot be read. */
export async function absorbGame(
  io: ConfigFileIO,
  writeDir: string,
  game: GameHandler & { handler: NonNullable<GameHandler["handler"]> },
  rows: readonly WidgetRow[],
  /** Widgets whose entry in the file is not to be taken into the set. */
  skip: readonly string[] = [],
): Promise<GameFile> {
  const { config } = game.handler;
  const shortName = game.shortName ?? "";
  let written = readSets().written;
  let found = await findConfig(io, writeDir, config, shortName);
  // A launch that wrote the file while it was being read leaves this copy
  // older than its record, and the difference would read as an edit made in
  // the game. Read it again.
  while (found && readSets().written[found.path] !== written[found.path]) {
    written = readSets().written;
    found = await findConfig(io, writeDir, config, shortName);
  }
  if (!found) return { kind: "missing" };
  const order = readOrder(found.text, config.shape);
  const widgets = gameWidgets(rows, game.game).filter(
    (w) => !skip.includes(w.name),
  );
  updateSets((sets) =>
    absorbFile(sets, setKey(game), found.path, order, widgets),
  );
  return { kind: "ready", path: found.path, order };
}

/**
 * Write the set that applies to `game` into its config file, after taking in
 * anything changed there since coilbox last wrote it. Creates the file for a
 * game that has not saved one yet, so the set applies from its first launch.
 * Does nothing for a game whose handler coilbox does not recognise.
 */
export async function writeSetForLaunch({
  enginePath,
  dataDir,
  game,
}: {
  enginePath: string;
  dataDir: string;
  game: string;
}): Promise<void> {
  const engineConfig = await unitsyncEngineConfig({ enginePath, dataDir });
  const writeDir = engineConfigDir(engineConfig.configPath);
  if (!writeDir) return;
  const scan = await primeScan(enginePath, dataDir);
  const item = scan.games.find((g) => g.name === game);
  if (!item) return;
  const handler = await handlerOf(enginePath, dataDir, item);
  if (!handler) return;
  const entry = {
    game,
    shortName: item.info.shortname?.trim() || undefined,
    handler,
  };
  // The widgets are under every content root, which every engine reads, and
  // the game's config is in the engine's write folder (issues #4856, #4861).
  const widgets = await scanWidgets(dataDir);
  await writeGameFile(writeDir, entry, widgetRows(widgets, [entry]), [], () =>
    newConfigText(enginePath, dataDir, item, handler),
  );
}

/**
 * Take what changed in `game`'s config file since coilbox last wrote it into
 * its set, then write the set back, so a change made in the game is kept and
 * the rest is as the set says. A game that has not saved a file gets one only
 * when `create` says what it starts as.
 */
async function writeGameFile(
  writeDir: string,
  entry: GameHandler & { handler: NonNullable<GameHandler["handler"]> },
  rows: readonly WidgetRow[],
  skip: readonly string[] = [],
  create?: () => Promise<string | null>,
): Promise<void> {
  await absorbGame(appFileIO, writeDir, entry, rows, skip);
  // Read after the absorb above, so a change made in the game is written back
  // rather than undone.
  const states = statesToWrite(
    readSets(),
    setKey(entry),
    gameWidgets(rows, entry.game),
  );
  const out = await writeWidgetStates({
    io: appFileIO,
    writeDir,
    config: entry.handler.config,
    shortName: entry.shortName ?? "",
    states,
    create,
  });
  if (out) updateSets((sets) => recordWrite(sets, out.path, states));
}

/**
 * Switch widgets that were just added on in the set the player was looking at
 * and off in every other, and write that into the config file of each game
 * that has one, so a game launched without coilbox keeps them off too. `key` is
 * the set shown, `null` for the one every game uses. Returns what could not be
 * written, one line per game.
 */
export async function switchAddedWidgets({
  widgetDir,
  writeDir,
  games,
  key,
  names,
}: {
  /** The selected content root, which the other roots are listed after. */
  widgetDir: string;
  /** The engine's write folder, where the games keep their config. */
  writeDir: string;
  games: readonly GameHandler[];
  key: string | null;
  names: readonly string[];
}): Promise<string[]> {
  if (names.length === 0) return [];
  updateSets((sets) => addWidgets(sets, key, names));
  return writeSwitched({ widgetDir, writeDir, games, names });
}

/**
 * Switch widgets that were just restored off in every set, and write that into
 * the config file of each game that has one, so none runs in the next game
 * without the player turning it on. Returns what could not be written, one
 * line per game.
 */
export async function switchRestoredWidgets({
  widgetDir,
  writeDir,
  games,
  names,
}: {
  /** The selected content root, which the other roots are listed after. */
  widgetDir: string;
  /** The engine's write folder, where the games keep their config. */
  writeDir: string;
  games: readonly GameHandler[];
  names: readonly string[];
}): Promise<string[]> {
  if (names.length === 0) return [];
  updateSets((sets) => switchOff(sets, names));
  return writeSwitched({ widgetDir, writeDir, games, names });
}

/** Write the sets' answer for `names` into each game's config file. Called
 *  after the sets are changed, and before the files are read, so that a widget
 *  no file has an entry for takes this answer rather than what its `GetInfo()`
 *  says. The files' own entries for these names are left out of what is read
 *  back, because one a removed copy of the widget left behind would otherwise
 *  undo the choice. */
async function writeSwitched({
  widgetDir,
  writeDir,
  games,
  names,
}: {
  widgetDir: string;
  writeDir: string;
  games: readonly GameHandler[];
  names: readonly string[];
}): Promise<string[]> {
  const scan = await scanWidgets(widgetDir);
  const rows = widgetRows(scan, games);
  const failed: string[] = [];
  for (const game of games) {
    if (!game.handler) continue;
    try {
      await writeGameFile(
        writeDir,
        { ...game, handler: game.handler },
        rows,
        names,
      );
    } catch (e) {
      failed.push(`${game.game}: ${errorText(e)}`);
    }
  }
  return failed;
}
