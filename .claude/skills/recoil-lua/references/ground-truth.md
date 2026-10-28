# Finding out what the engine actually does

Models confidently misremember the Spring and Recoil Lua API. Old Spring wiki pages, forum posts and other games' code disagree with each other and with the current engine. When a question matters, settle it from one of these sources, in this order.

## 1. The engine binary

The binary describes itself and exits without starting a game, so these flags work even where a game will not run:

| Flag | Prints |
|---|---|
| `--list-config-vars` | every config var with its type, default, minimum, maximum and description, as JSON |
| `--list-unsynced-commands` | every unsynced chat command, such as `/luaui` |
| `--list-synced-commands` | every synced chat command, such as `/luarules` and `/cheat` |
| `--list-def-tags` | every unit, feature and weapon def tag the engine reads |
| `--list-ceg-classes` | the projectile classes available to effect generators |

Use the binary for the engine version the game runs on. A config key the binary does not list is either read by the game's own Lua or no longer exists.

## 2. The engine source

https://github.com/beyond-all-reason/RecoilEngine. Clone it, then grep it locally rather than fetching one file at a time.

- `rts/Lua/LuaSyncedRead.cpp`, `LuaSyncedCtrl.cpp`, `LuaUnsyncedRead.cpp` and `LuaUnsyncedCtrl.cpp` hold the `Spring.*` functions. The file name says which states can call them.
- `rts/Lua/LuaHandle.cpp` and `LuaHandleSynced.cpp` hold the call-ins and the synced sandbox.
- `rts/Lua/LuaOpenGL.cpp`, `LuaVBO*.cpp`, `LuaVAO*.cpp` and `LuaShaders.cpp` hold `gl.*`.
- `rts/Lua/LuaConstGame.cpp` holds the `Game.*` constants.
- `rts/Lua/LuaUnitScript.cpp` and `rts/Sim/Units/Scripts/Cob*.cpp` hold the two unit script runtimes. COB call-ins take packed integer arguments where Lua unit scripts take plain values, so read both before porting a script between them.
- `rts/Game/SyncedGameCommands.cpp` and `UnsyncedGameCommands.cpp` hold the chat commands and their cheat checks.
- `rts/Sim/` holds the simulation rules, such as movement, building placement and transports.
- `cont/` holds the base content shipped with the engine: the default LuaUI widget handler (`cont/LuaUI/widgets.lua`) and the base gadget handler (`cont/base/springcontent/LuaGadgets/gadgets.lua`).

The functions carry `@function` doc comments, so `grep -rn '@function Spring.GetUnitHeading' rts/Lua` finds both the binding and its documented arguments.

## 3. The documentation site

Generated from the same repository:

- Lua API reference: https://recoilengine.org/docs/lua-api/
- Chat commands: https://recoilengine.org/docs/unsynced-commands/ and https://recoilengine.org/docs/synced-commands/
- Config vars: https://recoilengine.org/docs/configuration-variables/
- Widgets, gadgets and handlers: https://recoilengine.org/docs/guides/getting-started/widgets-and-gadgets/
- The virtual file system: https://recoilengine.org/docs/guides/getting-started/vfs-basics/
- Changes from Spring: https://recoilengine.org/docs/guides/migrating-from-spring/

For editor type checking, https://github.com/beyond-all-reason/recoil-lua-library has Lua Language Server definitions for the whole API.

## 4. The game itself

The game decides everything above the engine: its widget and gadget handlers, its own chat commands, and which unit defs exist. Read the game's archive or repository before assuming a handler method, a `WG` or `GG` table entry, or a def field.

## Misleading errors

- `GAME-section missing from setup-script` on a start script that has a `[GAME]` section has meant that the engine could not open its base content (`springcontent.sdz`). Look earlier in `infolog.txt` for a failure to open the "Spring content" archive.

## Testing Lua outside the engine

Most logic can be tested without launching the engine. Keep pure logic in modules that take their inputs as arguments, and keep call-ins thin. Then run the modules under a standalone Lua with small stub tables for `Spring`, `VFS` and `gl`.

That catches logic errors quickly, but it differs from the engine in ways that hide bugs:

- Standalone Lua and LuaJIT use 64-bit doubles. The engine uses 32-bit floats.
- LuaJIT accepts `goto` and some other syntax that Lua 5.1.4 rejects. Run a syntax check with a stock Lua 5.1 if you can.
- Stubs do not apply the synced `math.random` and `pairs` rules, or the line-of-sight limits on LuaUI reads.

Use the engine for what stubs cannot show: real call-in order, real unit behaviour and drawing.
