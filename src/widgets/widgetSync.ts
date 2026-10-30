/**
 * Reading a game's config file into the widget sets, and writing the set that
 * applies back into it before a launch (issue #4844).
 */

import { appFileIO } from "@/blueprint/fileIO";
import { contentPlayerWidgets, unitsyncEngineConfig } from "@/content/bindings";
import { primeScan } from "@/content/config";
import { engineConfigDir } from "@/content/enginePaths";
import { handlerOf } from "./gameHandler";
import { HANDLER_FOLDERS } from "./handlers";
import {
  type ConfigFileIO,
  findConfig,
  readOrder,
  writeWidgetStates,
} from "./widgetConfig";
import { type GameHandler, type WidgetRow, widgetRows } from "./widgetList";
import {
  absorbFile,
  gameWidgets,
  readSets,
  recordWrite,
  setKey,
  statesToWrite,
  updateSets,
} from "./widgetSets";

/** What reading one game's config file found. */
export type GameFile =
  /** The game has not saved one yet. */
  | { kind: "missing" }
  | { kind: "ready"; path: string }
  /** It is there and could not be read. */
  | { kind: "error"; error: string };

/** Read one game's config file and take any change made outside coilbox into
 *  the set it uses. Throws when the file is there and cannot be read. */
export async function absorbGame(
  io: ConfigFileIO,
  writeDir: string,
  game: GameHandler & { handler: NonNullable<GameHandler["handler"]> },
  rows: readonly WidgetRow[],
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
  const widgets = gameWidgets(rows, game.game);
  updateSets((sets) =>
    absorbFile(sets, setKey(game), found.path, order, widgets),
  );
  return { kind: "ready", path: found.path };
}

/**
 * Write the set that applies to `game` into its config file, after taking in
 * anything changed there since coilbox last wrote it. Does nothing for a game
 * whose handler coilbox does not recognise, or that has not saved a file yet:
 * a file coilbox made from nothing could be thrown away whole (see
 * `widgetConfig.ts`), and the game saves one when it first exits.
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
  const widgets = await contentPlayerWidgets({
    writeDir,
    folders: HANDLER_FOLDERS,
  });
  const rows = widgetRows(widgets, [entry]);
  const file = await absorbGame(appFileIO, writeDir, entry, rows);
  if (file.kind !== "ready") return;
  // Read after the absorb above, so a change made in the game is written back
  // rather than undone.
  const states = statesToWrite(
    readSets(),
    setKey(entry),
    gameWidgets(rows, game),
  );
  const out = await writeWidgetStates({
    io: appFileIO,
    writeDir,
    config: handler.config,
    shortName: entry.shortName ?? "",
    states,
  });
  if (out) updateSets((sets) => recordWrite(sets, out.path, states));
}
