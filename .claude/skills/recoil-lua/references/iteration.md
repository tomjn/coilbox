# Iterating on Lua in a running game

An engine launch costs a full load of the game and map, and a scripted match may add a spawn or faction-picking phase on top. Start one game and reload the Lua inside it for each change.

## Reload commands

Type these in the game's chat box, or send them from Lua with `Spring.SendCommands("luaui reload")` (no leading slash).

| Command | Needs cheats | What it does |
|---|---|---|
| `/luaui reload` | No | Shuts LuaUI down and loads it again from disk, rerunning every widget's `Initialize`. |
| `/luaui disable`, `/luaui enable` | No | Unloads or loads LuaUI. |
| `/luarules reloadunsynced` | No | Reloads only the unsynced half of LuaRules. |
| `/luarules reload` | Yes | Reloads both halves of LuaRules. Refused before the first game frame. |
| `/luarules disable`, `/luarules enable` | Yes | Unloads or loads LuaRules. |
| `/luagaia reload` and the rest | As LuaRules | The same set for LuaGaia, when the game uses it. |
| `/luamenu reload` | No | Reloads the main menu Lua. |

Turn cheats on with `/cheat`. That only works in a game you control, such as a local skirmish or a test start script.

Source: `rts/Game/UnsyncedGameCommands.cpp` (`LuaUIActionExecutor`, `LuaMenuActionExecutor`) and `ExecuteSyncedLuaAction` in `rts/Game/SyncedGameCommands.cpp`.

A reload resets every local variable in the reloaded code. The base widget handler saves what a widget returns from `GetConfigData` and passes it back to `SetConfigData`, so state worth keeping across reloads belongs there. Anything else starts fresh.

## Toggling one widget or gadget

The engine's base handlers accept these as chat commands. A game with its own handler may not, so check its `luaui/` or `luarules/` folder.

- `/luaui togglewidget <name>`, `/luaui enablewidget <name>` and `/luaui disablewidget <name>`. The name is the `name` field from the widget's `GetInfo`, not the file name (`cont/LuaUI/widgets.lua:1130-1138`).
- `/luarules togglegadget <name>`, `enablegadget` and `disablegadget`. These need cheats and only work for player 0 (`cont/base/springcontent/LuaGadgets/gadgets.lua:921-937`).

## Where a development widget goes

The base handler loads widgets from `LuaUI/Widgets/` in two passes. The first pass reads loose files from the data directories (`VFS.RAW_ONLY`). The second reads files packed in the game archive (`VFS.ZIP_ONLY`). So a widget file copied into `LuaUI/Widgets/` under the write directory loads without repacking the game. Copy the new version over it, then send `/luaui reload`.

Loose user widgets are enabled automatically unless the config var `LuaAutoEnableUserWidgets` is 0. A game with its own handler may load loose widgets differently or not at all.

## Running the engine from a script

Use this to check a change you cannot check in a running game, or to test with no window at all.

- Prefer `spring-headless`. It runs the simulation and widgets but draws nothing, so it is faster and takes no window. Its rendering calls do nothing, so it cannot test drawing code.
- Start a match by passing a start script file as the only positional argument. The format is documented at https://recoilengine.org/articles/start-script-format/. The same argument accepts a replay or a saved game. With no script, `--game <name> --map <name>` starts a minimal match (`rts/System/SpringApp.cpp:721-753`).
- Keep test runs out of a player's data with `--write-dir <dir>`. Add `--isolation --isolation-dir <dir>` to stop the engine scanning the normal data folders for games and maps.
- `Spring.Echo` writes to `infolog.txt` in the write directory. Read that file for results and errors rather than scraping the window.
- Make the test end the match itself with `Spring.SendCommands("quitforce")` once its result is written. Also wrap the launch in `timeout`, and kill the engine by its process id if it outlives the timeout.
- Run one engine at a time. Several at once load the machine, and windowed ones cover the user's screen.
- Batch questions into one run. Do not launch the same run again without changing something first.

### Windowed runs

- Do not move the user's mouse. Leave `Spring.WarpMouse` out of test code, and do not let the camera edge-scroll on a window the user might be working near.
- Do not echo console text on the same frame as a `screenshot` command. On engine 2026.09.01 on macOS a test widget that sent `screenshot png` and then `Spring.Echo` froze the engine. The likely cause is a lock both the screenshot and the console font take. Report results through `Spring.Echo` only, and take any screenshot on a quiet frame.
