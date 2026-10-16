# What the engine reloads in a running game

When you change a unit while a game is running, the engine picks up a changed Lua unit script and nothing else. A changed unit definition, model or new file needs the game restarted. This page says what each part of a unit does, how to reload what can be reloaded, and what the unit builder's sandbox does with that.

It answers issue #3344. The sandbox is #3341 and its reload button is #3346.

## The answer

| Part of the unit | Reloads in a running game | How | Live units | Evidence |
|---|---|---|---|---|
| Lua unit script | Yes | `/cheat 1`, then `/luarules reload` | Get the new script, and `script.Create` runs again | Engine run and source |
| COB unit script | Yes | `/cheat 1`, then `/reloadcob <unit>` | Get the new script | Source, and an engine run showing it ignores a Lua script |
| Unit definition, `units/<unit>.lua` | No | Restart | Keep their old values | Engine run and source |
| Unit definition values, edited from Lua | Partly | `/cheat 1`, `/editdefs 1`, then a synced gadget writes `UnitDefs[id].<key>` | Keep their old values, and only new units get the edit | Engine run and source |
| Model, `.s3o` | No | Restart | Keep the old model, and so do new units | Engine run and source |
| Texture | Probably yes, for a file that already existed | `/reloadtextures s3o` | Get the new texture | Source only, not run |
| Any file that did not exist when the game started | No | Restart | Not applicable | Engine run and source |
| Full restart | Yes | Quit and launch again, or `Spring.Reload(script)` from Lua | All gone, new game | Engine run and source |

All of it was tested on Splinter Faction 0.1.89 with `spring-headless` from engine 2026.07.04-46-g04f42e2, on this Mac. Source lines are from the RecoilEngine checkout at commit `212c369b4c`.

## Why a new file never appears

A game in a `.sdd` folder is read through `CDirArchive`. When the engine opens the archive it lists every file in the folder once and keeps that list (`rts/System/FileSystem/Archives/DirArchive.cpp:37`). When something asks for a file's contents, it opens the file on disk again (`DirArchive.cpp:59`).

So an edit to a file that existed at launch is seen by anything that reads the file again. A file created after launch does not exist as far as the game is concerned, and neither `/luarules reload` nor anything else short of a restart lists the folder again. The test made `scripts/brand_new.lua` and `units/probe_two.lua` mid-game, and `VFS.FileExists` returned false for both until the restart.

For the builder this means an export into a running sandbox must only change files the sandbox already had. Renaming the unit, or adding a script include, needs a restart.

## Scripts

### Lua scripts

`/luarules reload` reloads every gadget, including the unit script gadget, which reads each unit script file from disk again. The gadget then calls its own `UnitCreated` for every unit already alive (`cont/base/springcontent/LuaGadgets/Gadgets/unit_script.lua:572`), so every live unit gets a fresh copy of the new script and `script.Create` runs again for it. You do not need to respawn the unit.

It needs cheats on, and it refuses before the first game frame (`ExecuteSyncedLuaAction` in `rts/Game/SyncedGameCommands.cpp:325`). Without cheats the engine logs a warning and does nothing.

From the test, after the script on disk changed from version 1 to version 2:

```
0:12.974181 f0000070 Warning: synced luarules scripts require cheating to reload
0:14.308435 f0000110 Cheating is enabled!
0:14.352790 f0000110 gadget loaded, load 2, frame 110, generation 1
0:14.410058 f0000110 script.Create version 2 unit 29235
0:14.410124 f0000110 script.Create version 2 unit 26126
0:15.304383 f0000110 LuaRules loaded
```

Both units were spawned while the old script was in place. A unit spawned after the file changed, but before the reload, still ran version 1, so nothing re-reads the file until something asks.

The reload took 1.0 seconds, from the cheat taking effect to `LuaRules loaded`, with the game paused on frame 110 throughout.

The cost is that every gadget in the game starts again from nothing. Splinter Faction reloaded 109 synced gadgets without new errors. But any state a gadget holds in its own variables is lost: an upgrade a team bought, a wave counter, a scenario's progress. A gadget can keep state it needs through a reload in game rules params, which the engine holds. The probe gadget did that to count its own loads.

Splinter Faction does not handle the reload differently from the base game. Its `LuaRules/Gadgets/unit_script.lua` is the base content gadget, included from `springcontent.sdz`.

### COB scripts

`/reloadcob <unit def name>` reloads a COB script and swaps it into every live unit of that definition, calling `Create` on each (`CGame::ReloadCOB` in `rts/Game/Game.cpp:2107`, `CUnitScriptEngine::ReloadScripts` in `rts/Sim/Units/Scripts/UnitScriptEngine.cpp:66`). It needs cheats on. It does nothing for a unit with a Lua script, and the test shows that:

```
Warning: [UnitScriptEngine::ReloadScripts] unknown COB script for unit "probe_unit": scripts/probe_unit.lua
```

The unit builder writes Lua scripts, so this route does not help it. It would help a game maker editing a game's own COB units.

## Unit definitions

Nothing re-reads `units/<unit>.lua` while a game runs. The engine parses unit definitions once at load. The test changed `maxdamage` from 1000 to 2000 and the name from "Probe unit v1" to "Probe unit v2", and neither showed up after `/luarules reload`. Both appeared after a restart.

`/editdefs 1` lets Lua write to the definitions the engine already has. It needs cheats on. The write goes straight into the engine's unit definition (`UnitDefNewIndex` in `rts/Lua/LuaUnitDefs.cpp:172`), so do it from synced gadget code or a multiplayer game desyncs.

Which keys you can write:

- Plain values can be written. `InitParamMap` in `LuaUnitDefs.cpp` declares 214 of them, every number, boolean and string the `UnitDefs` table shows, for example `health`, `buildTime`, `metalCost`, `speed`, `humanName` and `scriptName`.
- Tables cannot be written. `weapons`, `customParams`, `buildOptions`, `model`, `moveDef` and `collisionVolume` all fail with "Can not write to ...".
- A new unit definition cannot be added.

From the test:

```
edit buildTime = 999: ok
edit scriptName = other.lua: ok
edit health = 5000: ok
edit humanName = Edited name: ok
edit customParams = <table>: Can not write to customParams
edit weapons = <table>: Can not write to weapons
```

Live units do not see an edit. A unit copies values such as its health, build time and tooltip from the definition when it is created (`rts/Sim/Units/Unit.cpp:270` to `279`). Units created after the edit get the new values, unless a game gadget overrides them.

Splinter Faction is one where a gadget overrides them. After `health = 5000`, a new unit still had 1000 health, while its tooltip did read "Edited name". Splinter Faction's `game_team_upgrades.lua` copies every unit's health when it starts and sets it again on each new unit. A `/luarules reload` after the edit would make that gadget copy the new value, but that was not tested.

The values in `UnitDefs` are also not the values in the file. The game's `alldefs_post.lua` and the engine both change them on the way in. The probe's `buildtime = 100` reads back as `buildTime = 569999680`. Copying values from an edited file into `UnitDefs` would need coilbox to repeat the game's own processing, so this is not a way to reload a unit definition.

## Models

There is no way to reload a model. The model loader keeps every model it has loaded under its name and hands back the same one on every later request (`CModelLoader::LoadModel` and `GetCachedModel` in `rts/Rendering/Models/IModelParser.cpp:280` to `296`). No command or Lua function clears that, and a search of `rts/Rendering/Models/` for "reload" finds nothing.

The test swapped `objects3d/probe_unit.s3o` for a model with 9 pieces in place of 5. Units already alive kept 5 pieces, and so did a unit spawned after a `/luarules reload`. After a restart a new unit had 9.

## Textures

`/reloadtextures s3o` loads every texture a model already uses again from disk and uploads it under the same OpenGL texture, so units already alive change too (`CS3OTextureHandler::Reload` in `rts/Rendering/Textures/S3OTextureHandler.cpp:70`, the command in `rts/Game/UnsyncedGameCommands.cpp:3787`). It is an unsynced command and needs no cheats.

It only reloads textures it already has, under the same file name. A new texture file is not seen, for the reason in "Why a new file never appears".

This was not run. A headless engine loads no textures, so it needs a test with a window.

## A full restart

There are two ways to restart:

- quit the engine and launch it again, which is what Test in game does now
- call `Spring.Reload(scriptText)` from unsynced Lua, which starts a new game in the same process

`Spring.Reload` closes the file system and opens it again (`SpringApp::Reload` in `rts/System/SpringApp.cpp:803` to `809`), so new files and the edited definition and model are all picked up. The test confirmed that: the new definition, the 9 piece model and both new files were all there after it.

It is not faster. Measured on Splinter Faction 0.1.89 and Small Supreme Battlefield V3, headless:

- launching the engine to the game starting took 10.6 seconds, with the archive cache already built
- `Spring.Reload` to the new game starting took 10.3 seconds

The first launch in a new write folder took 40.2 seconds. That covers scanning every archive once, and Splinter Faction's "Initial Settings" widget, which restarts the game once on its first run to build its texture atlases. A windowed engine loads textures and shaders as well, so a restart with a window will take longer. That was not measured.

## Sending a command to a running engine

Coilbox can send commands through the engine's autohost interface. This worked on this Mac, and every command above went through it: `/cheat 1`, `/luarules reload`, `/editdefs 1`, `/reloadcob`, a chat line and `/luarules <word>`.

The engine does not listen for the autohost. Coilbox listens, and the engine connects to it:

1. Coilbox binds a UDP socket on `127.0.0.1`. Port 0 lets the operating system pick a free one.
2. Coilbox gives the engine that port as `AutohostPort`. `AutohostIP` defaults to `127.0.0.1`.
3. When the game's server starts, the engine binds its own socket on a port the operating system picks, connects it to coilbox's port and sends a "server started" message (`AutohostInterface::TryBindSocket` in `rts/Net/AutohostInterface.cpp:221` to `223`).
4. Coilbox reads the engine's address from that first message and sends each command back to it as one datagram, for example `/luarules reload`.

The server reads one datagram per update (`CGameServer::Update`, `rts/Net/GameServer.cpp:847`). Text starting with one `/` is a command. Text starting with `//` or no slash is a chat line from the host.

`CGameServer::commandBlacklist` does not get in the way. It is the list of commands only the host may send (`GameServer.cpp:1773`). The autohost is the host, and its commands go straight to `PushAction`. A command from the autohost arrives with player number 255, the server's own, which a gadget's chat action sees.

`/quitforce` sent this way did nothing in the test, though the same command from a gadget stopped the engine. It is an unsynced command, and I did not trace why the server's copy of it is not run. Coilbox already stops the engine process itself.

The engine also sends coilbox every server message, such as "Player coilbox finished loading and is now ingame", and every Lua message a player sends (`GAME_LUAMSG`, `GameServer.cpp:1346`). So a gadget could confirm a reload back to coilbox with `Spring.SendLuaRulesMsg`.

### Setting the port without touching the player's settings

The start script cannot set `AutohostPort`, because it is an engine setting. Two ways were checked:

- `--config <file>` makes that file the engine's only settings, so the player's graphics and other settings would be lost for the sandbox
- a `springsettings.cfg` in any data folder is read as an extra settings file that the engine never writes to (`ConfigLocater::GetDefaultLocations`, `rts/System/Config/ConfigLocater.cpp:83`)

The second worked in the test:

```
Using additional read-only configuration source: ".../runs/autohost/data/springsettings.cfg"
  AutohostPort = 53344
```

Coilbox already passes its content folders in `SPRING_DATADIR` when it launches a game (`crates/tauri-plugin-coilbox-play/src/lib.rs`), so a sandbox launch can add one folder of its own that holds only that file. The player's own `springsettings.cfg` comes first, so a player who has set `AutohostPort` themselves would override it.

### The other way, a gadget that watches a file

A gadget in the scratch game can read a request file every second and run what it asks with `Spring.SendCommands`, from its unsynced half. That worked too: the probe sent `cheat 1`, `luarules reload`, `editdefs 1` and `quitforce` that way. It opens no socket and needs no setting. The request file has to exist when the game starts.

It is one way only, it has to keep its own state through the reload it starts, and once LuaRules fails to load there is nothing left to send the next reload.

## What the sandbox does

For the sandbox in #3341:

- Turn cheats on through the autohost once the game has started, so a reload never waits on them.
- Keep every file name the unit uses the same from one export to the next, and write every file the unit could need before launch. A reload only sees files that existed when the game started.

For the reload button in #3346:

- Send commands through the autohost interface, set up as described in "Sending a command to a running engine". It is the engine's own route, it would still work after LuaRules fails to load because the server reads it, and it can confirm what happened. The file watching gadget is the fallback if the autohost route turns out to be a problem.
- A changed script: export, then send `/luarules reload`. Live units get the new script, so there is no need to respawn them. Say that the game's gadgets started again.
- A changed definition, model or a new file: say a relaunch is needed, and offer it in the same place. Do not use `/editdefs` to fake a definition reload, because table values cannot be written, live units do not change, and the game's own processing of the file would have to be repeated.
- A changed texture: send `/reloadtextures s3o`, once a windowed test has shown it works.

## How it was tested

A throwaway game, `coilbox-reload-probe.sdd`, depended on Splinter Faction 0.1.89 and held one unit, `probe_unit`, plus a probe gadget. A shell script ran `spring-headless` on it and stepped the gadget through each route by rewriting a request file in the game folder. Between steps it swapped the unit's script, definition and model on disk for a second version, and added two new files. The gadget logged the definition, the files the game could see, and each live unit's script version, health, piece count and tooltip.

A second run did the same through a small UDP listener standing in for coilbox's end of the autohost interface.

The scripts and logs are not in the repository. They stay in `docs/reports/3344/`, which is gitignored.
