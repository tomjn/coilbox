# Browse archives and run Lua

Coilbox can open any game or map archive the engine can see, list the files inside it and show you each one. Each archive also has a Lua console. It runs Lua with that archive loaded, the same way the engine loads it, so you can check what a file returns without starting a game.

This page covers the Archives page, an archive's own page and the Lua console. The engine's Lua functions belong to the engine's own guides. See [Lua guides](#lua-guides) at the end.

## Turn on Archives

Archives is hidden until you turn on Advanced mode.

1. Open Settings, then General.
2. Under Advanced tools, turn on Advanced mode.

Archives now appears in the sidebar, under Library.

## The Archives page

Open Library > Archives. The page lists every archive your games and maps use, including the archives they depend on.

Each row shows the archive's file name, such as `SplinterFaction_0.1.89.sdz`, and its size. Labels beside the name say more about it:

- Game, Map or Other says what kind of archive it is. Other covers everything that is neither, such as the engine's own content archives.
- Primary marks the archive that is a game itself, rather than one it depends on.
- SDD marks a loose `.sdd` folder rather than a packed `.sdz` or `.sd7` file.

A game installed as a rapid package is listed under a long name of letters and numbers ending in `.sdp`, rather than the game's name.

The list comes from one engine. If you have more than one, pick the engine from the menu at the top of the page. Rescan reads your content folders again. While it reads, the button says Cancel scan, which stops it.

Select an archive to open its page.

## An archive's page

The top of the page shows the archive's file name and labels, its size, its checksum and where it is on your computer. Beside them are:

- Lua Console, which opens the [Lua console](#the-lua-console).
- View game or View map, which opens the game's or map's page in the Library.
- Open folder, which opens the folder that holds the archive. For a `.sdd` archive it opens the folder itself.
- Delete, which deletes the archive from your computer. It is there for an archive in a `games`, `maps` or `packages` folder, and it asks first. Replays and saves that need the archive stop working, and you would have to download it again.
- Convert models, which appears on an archive that has `.3do` models in `objects3d`. It turns them into `.s3o` models.

Dependencies lists the archives this one depends on. Select one to open its page.

### Look at a file

Contents lists every file in the archive as folders you can open. The heading says how many files there are.

Select a file to show it on the right:

- A text file, such as a `.lua`, `.tdf` or `.fbi` file, shows its text with the code coloured.
- An image shows as a picture.
- An `.s3o` or `.3do` model is drawn in 3D with its textures, with its triangle and piece counts. Open in the builder opens it in the [Unit builder](lego-builder.md).
- Any other file, or one too large to show, gives its size.

Copy puts a text file's contents on the clipboard. Download saves the file out of the archive to a place you pick.

## The Lua console

The console runs Lua with the archive loaded. Use it to check what a file in the archive returns, or whether a file is where the engine looks for it.

Select Lua Console on an archive's page. The console opens in a panel at the side. Open full page moves it to a page of its own, called Lua REPL, with the same session. You can also go back to the archive from there, by selecting its name at the top.

1. Type Lua in the box at the bottom.
2. Press Enter, or select Run. Shift and Enter adds a new line.
3. End your Lua with `return` to see a value.

The result appears above the box. A table is shown with its keys sorted. Anything you `print` appears above the result. An error shows in red.

The Up arrow brings back what you ran before on this archive, even after you close coilbox. Down goes forward again.

### Examples

Check that a map archive has its `mapinfo.lua` where the engine reads it. Open a map's archive and run:

```lua
return VFS.FileExists("mapinfo.lua")
```

It returns `true` if the file is at the top of the archive.

List the unit files in a game:

```lua
return VFS.DirList("units/", "*.lua")
```

If the game keeps its units in folders under `units`, list the folders first with `VFS.SubDirs("units/", "*")`.

Read a config file and look at it over two runs. In Splinter Faction, run:

```lua
defs = VFS.Include("gamedata/morph_defs.lua")
```

Then run:

```lua
local count = 0
for name in pairs(defs) do count = count + 1 end
return count
```

The second run returns how many units have a morph. It can see `defs` because the first run made it a global.

### How a session works

The console starts fresh for every Run. To keep your globals, it runs everything you ran before, in order, and then your new Lua. So:

- Globals carry over from one run to the next. A `local` does not.
- Lua that ended in an error is left out of later runs.
- Only the output of the latest run is shown.
- If something you ran before now fails, the error says session replay diverged, with the number of the run that failed.

Reset session clears what you have run and starts again with nothing. The session stays while coilbox is open, including when you close the panel or move to the full page.

Diagnostics under a result shows the engine's own messages about loading the archive, such as a dependency it could not find.

## What the console can reach

The console runs your Lua in the Lua parser of the engine's unitsync library, which lobbies use to read files like `modinfo.lua` and `mapinfo.lua`. It does not run in a game. No map is loaded and there are no players, teams or units.

It can reach:

- Every file in the archive and in the archives it depends on, through `VFS.Include`, `VFS.LoadFile`, `VFS.FileExists`, `VFS.DirList` and `VFS.SubDirs`.
- Plain Lua, such as `pairs`, `type`, `tostring` and the `string`, `table` and `math` libraries.
- The `Engine` table.
- `Spring.Echo`, `Spring.Log` and `Spring.TimeCheck`. Use `print` to see output in the console.

It cannot reach:

- `UnitDefs`, `UnitDefNames` or `Game`. A file that reads any of them raises an error here, even if it works in a game.
- The rest of `Spring`, such as `Spring.GetModOptions` or `Spring.GetTeamList`.
- Widgets, gadgets and anything else that runs during a game.

Nothing you run changes the archive. The console can read files but not write them.

## Lua guides

- [Lua VFS](https://springrts.com/wiki/Lua_VFS) on the Spring wiki explains the `VFS` functions and how the engine finds files.
- [Lua API](https://recoilengine.org/docs/lua-api/) is the Recoil engine's list of Lua functions.
