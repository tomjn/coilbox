/**
 * Which widget handler a game runs, and so which folders it loads a player's
 * widgets from (issue #1284).
 *
 * The engine does not decide where player widgets live. It starts the game's
 * own handler, and most games copied theirs from another game and changed a
 * little. So a handler here is a family plus the few values that differ, found
 * from the files the game's archives ship, rather than code per game.
 *
 * The markers and folders were read from the handlers in the games' own
 * archives: `bawidgets.lua`, `cawidgets.lua`, `mfwidgets.lua`,
 * `widgets_custom.lua`, Spring 1944's `config.lua` and the two `widgets.lua`
 * files, plus `widgets_evo.lua`, `jauriawidgets.lua`, `mosaicwidgets.lua` and
 * `tapwidgets.lua` (#4845). Beyond All Reason's come from the issue.
 *
 * Later issues in the Widget manager milestone add each handler's config file
 * (#1289) and its option that turns player widgets off (#1292) to
 * {@link WidgetHandler}. A game whose handler is not recognised gets `null` and
 * so is never written for.
 */

/** The handlers that share one ancestor and work the same way. */
export type HandlerFamily =
  /** The engine's default handler: Metal Factions, Basically OTA, Evolution
   *  RTS, Imperial Winter and Splinter Faction's heavily changed fork. */
  | "engine"
  /** Balanced Annihilation's, which Beyond All Reason's, MOSAIC's and Total
   *  Annihilation Prime's grew from. */
  | "ba"
  /** Complete Annihilation's, which Zero-K's and Jauria RTS's grew from. */
  | "ca"
  /** jK's LuaHandler: Spring 1944. */
  | "jk"
  /** The handler from before engine 0.83: Expand and Exterminate. */
  | "legacy";

export interface WidgetHandler {
  /** Which rule recognised it, stable across releases. */
  id: string;
  family: HandlerFamily;
  /** The folders it loads player widgets from, relative to the engine's write
   *  folder and spelled as the handler spells them. */
  folders: readonly string[];
  /** Whether it also loads widgets one subfolder down. */
  subfolders: boolean;
}

interface Rule extends WidgetHandler {
  /** A file the game's archives ship, lower case. */
  marker: string;
  /** Text that file has to contain, when the file name alone is shared. */
  contains?: string;
}

/** In the order they are tried: a game that ships two markers is the first. */
const RULES: readonly Rule[] = [
  {
    id: "bar",
    family: "ba",
    marker: "luaui/barwidgets.lua",
    folders: ["LuaUI/Widgets", "LuaUI/RmlWidgets"],
    subfolders: true,
  },
  {
    id: "ba",
    family: "ba",
    marker: "luaui/bawidgets.lua",
    folders: ["LuaUI/widgets"],
    subfolders: false,
  },
  {
    id: "ca",
    family: "ca",
    marker: "luaui/cawidgets.lua",
    folders: ["LuaUI/Widgets"],
    subfolders: false,
  },
  {
    id: "mf",
    family: "engine",
    marker: "luaui/mfwidgets.lua",
    folders: ["LuaUI/Widgets"],
    subfolders: false,
  },
  {
    id: "sf",
    family: "engine",
    marker: "luaui/widgets_custom.lua",
    folders: ["LuaUI/widgets"],
    subfolders: false,
  },
  {
    id: "evo",
    family: "engine",
    marker: "luaui/widgets_evo.lua",
    folders: ["LuaUI/Widgets_Evo"],
    subfolders: false,
  },
  {
    id: "jauria",
    family: "ca",
    marker: "luaui/jauriawidgets.lua",
    folders: ["LuaUI/Widgets"],
    subfolders: false,
  },
  {
    id: "mosaic",
    family: "ba",
    marker: "luaui/mosaicwidgets.lua",
    folders: ["LuaUI/widgets_mosaic"],
    subfolders: false,
  },
  {
    id: "tap",
    family: "ba",
    marker: "luaui/tapwidgets.lua",
    folders: ["LuaUI/Widgets_TAP"],
    subfolders: false,
  },
  {
    // Ships a `luaui.lua` that starts the engine's own handler, so the only
    // file that says it is Imperial Winter is its UI config.
    id: "iw",
    family: "engine",
    marker: "luaui/config/iwui.config.lua",
    folders: ["LuaUI/Widgets"],
    subfolders: false,
  },
  {
    id: "jk",
    family: "jk",
    marker: "luaui/main.lua",
    contains: "LuaHandler/handler.lua",
    folders: ["LuaUI/Widgets", "LuaUI/Addons"],
    subfolders: false,
  },
  {
    // Before engine 0.83 every game's handler saved to one shared pair of
    // files, which is what tells it apart from the default handler of the
    // same file name.
    id: "legacy",
    family: "legacy",
    marker: "luaui/widgets.lua",
    contains: "Config/widget_order.lua",
    folders: ["LuaUI/Widgets"],
    subfolders: false,
  },
  {
    id: "engine",
    family: "engine",
    marker: "luaui/widgets.lua",
    folders: ["LuaUI/Widgets"],
    subfolders: false,
  },
];

/** The engine's own handler, from the engine folder, which runs when the game
 *  ships no handler of its own. */
const ENGINE_OWN: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
};

/** Files whose presence says the game starts a handler of its own. */
const OWN_ENTRY = ["luaui.lua", "luaui/main.lua", "luaui/widgets.lua"];

/** Every folder name under `LuaUI/` any recognised handler reads, lower case,
 *  which is what the folder scan is asked for. */
export const HANDLER_FOLDERS: readonly string[] = [
  ...new Set(
    RULES.flatMap((r) => r.folders).map((f) =>
      f.slice(f.indexOf("/") + 1).toLowerCase(),
    ),
  ),
];

function strip(rule: Rule): WidgetHandler {
  return {
    id: rule.id,
    family: rule.family,
    folders: rule.folders,
    subfolders: rule.subfolders,
  };
}

/**
 * The handler a game runs, from every file its archives ship, or `null` when
 * it ships a handler none of the rules know. `read` returns one of those
 * files' text, and is only asked for a rule that needs to look inside.
 */
export async function recogniseHandler(
  files: readonly string[],
  read: (file: string) => Promise<string | null>,
): Promise<WidgetHandler | null> {
  const byLower = new Map(files.map((f) => [f.toLowerCase(), f]));
  for (const rule of RULES) {
    const file = byLower.get(rule.marker);
    if (file === undefined) continue;
    if (rule.contains === undefined) return strip(rule);
    const text = await read(file);
    if (text?.includes(rule.contains)) return strip(rule);
  }
  return OWN_ENTRY.some((f) => byLower.has(f)) ? null : ENGINE_OWN;
}

/** A scanned widget file, as far as deciding who loads it needs. */
export interface ScannedFile {
  /** The scanned folder it is in or under, spelled as on disk. */
  folder: string;
  nested: boolean;
}

/**
 * Whether `handler` loads `file`. On a filesystem that folds case the
 * handler's `LuaUI/Widgets` is the same folder as `LuaUI/widgets` on disk. On
 * one that does not, the engine reads only the spelling the handler asks for,
 * so the two are different folders and only the exact one counts.
 */
export function loads(
  handler: WidgetHandler,
  file: ScannedFile,
  caseSensitive: boolean,
): boolean {
  if (file.nested && !handler.subfolders) return false;
  return handler.folders.some((folder) =>
    caseSensitive
      ? folder === file.folder
      : folder.toLowerCase() === file.folder.toLowerCase(),
  );
}
