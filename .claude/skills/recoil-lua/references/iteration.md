# Iterating on Lua in a running game

An engine launch costs a full load of the game and map, and a scripted match may add a spawn or faction-picking phase on top. A running game can reload its Lua instead, which is often faster. A restart can still be simpler, for example when the change is to defs, to the start script, or to state that only builds up from the start of a match.

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

Find the write directory in `infolog.txt` rather than guessing. The engine logs it as `using writeable data-directory "..."` (`rts/System/FileSystem/DataDirLocater.cpp:259`). It is often not `~/.spring`. On macOS and Linux `~/.config/spring` is added first and wins. If a `springsettings.cfg` sits next to the engine binary, the engine runs in portable mode and writes to its own folder.

Widget discovery merges every data directory, so a widget in any of them is found. Looking up a single file takes the first match instead, so a stale loose copy of a file silently overrides the one you edited. Check for old copies when a change has no effect.

### Editing the game's own LuaUI

A loose copy of the game's widget handler or LuaUI entry point is ignored by default, because LuaUI loads its entry point from the game archive first. Lua dev mode flips that order (`rts/Lua/LuaUI.cpp:92`). Turn it on with `LuaDevMode=1` in the `[MODOPTIONS]` block inside the start script's `[GAME]` section (`rts/Game/GameSetup.cpp:630`), or with `/devlua` in a game with cheats on. The engine warns that dev mode can cause desyncs, so use it only in local test games.

## Running the engine from a script

Use this to check a change you cannot check in a running game, or to test with no window at all.

- Prefer `spring-headless`. It runs the simulation and widgets but draws nothing, so it is faster and takes no window. Its rendering calls do nothing, so it cannot test drawing code.
- Start a match by passing a start script file as the only positional argument. The format is documented at https://recoilengine.org/articles/start-script-format/. The same argument accepts a replay or a saved game. With no script, `--game <name> --map <name>` starts a minimal match (`rts/System/SpringApp.cpp:721-753`).
- Keep test runs out of a player's data with `--write-dir <dir>`. Add `--isolation --isolation-dir <dir>` to stop the engine scanning the normal data folders for games and maps. Isolation replaces the automatic data directories. The `SPRING_DATADIR` environment variable adds to them instead, which can fail with `duplicate base content detected` when two directories both hold the base archives.
- `Spring.Echo` writes to `infolog.txt` in the write directory. Read that file for results and errors rather than scraping the window. The engine buffers stdout when it is redirected, so a log that stops early does not mean the engine stopped there.
- Let the game drive the run when it can. Beyond All Reason, for example, has a `debugcommands` modoption that runs `frame:command` pairs from the start script, such as `1:cheat|15:luarules benchmark ...`, so a scripted match needs no test widget. This is game code, so check the game before relying on it.
- Make the test end the match itself with `Spring.SendCommands("quitforce")` once its result is written. Also wrap the launch in `timeout`, and kill the engine by its process id if it outlives the timeout.
- Run one engine at a time. Several at once load the machine, and windowed ones cover the user's screen.
- Batch questions into one run. Do not launch the same run again without changing something first.

### Windowed runs

- Do not move the user's mouse. Leave `Spring.WarpMouse` out of test code, and do not let the camera edge-scroll on a window the user might be working near.
- Ask the user before launching a windowed engine. A windowed run has used about 9 GB of a 16 GB Mac, measured by the machine rather than the process, and unannounced runs have caused a system out-of-memory error. Building needs no warning.
- Check for engine processes left over from earlier runs before starting one, or windows pile up and input goes to whichever is on top. A launcher script that ends in `exec ./spring` shows in `ps` as `./spring`, so matching on the script's path finds nothing.
- Synthetic input is unreliable on macOS. Warping the cursor sends no motion event, so the next click lands where the pointer used to be. Posted drag events cannot resize a window.
- On engine 2026.09.01, sending `screenshot png` and then calling `Spring.Echo` on the same frame froze the engine. This is a known bug with a fix submitted. On an engine without the fix, take screenshots on a frame that echoes nothing.
