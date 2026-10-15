# Get games, maps and engines

To play anything you need three things on your computer: an engine, a game and a map. The engine is the program that runs the game. This page covers downloading each one, installing a file you already have, and choosing the folders coilbox reads from and saves to.

The download pages are under Downloads in the sidebar: Browse Rapid, Maps and Games. Engines and folders are in Settings, under Library.

## Choose where new games and maps go

Coilbox looks for games, maps and engines in your content folders. It finds the usual ones by itself, for example the folder another lobby already uses.

To see them, open Settings, then Library > Content folders.

The top of the page, New content goes to, decides where downloads are saved:

- Default is the folder new games, maps and engines go to.
- Games and Maps can each send that kind somewhere else. Same as default keeps them with everything else.

Each folder below has labels saying what goes there, such as "new content goes here". It also shows how many engines, maps, games and packages it holds.

If the Maps or Games download page says no download folder is set, pick one here.

## Add a content folder

1. Open Settings, then Library > Content folders.
2. Select Add folder.
3. Pick the folder that holds your games and maps folders.

If the folder does not look like a game folder, coilbox says so. Select Add anyway to keep it, or Cancel.

Each folder has these buttons:

- Open shows the folder on your computer.
- Re-scan reads that one folder again.
- Remove takes a folder you added off the list. Your files stay on disk. Folders coilbox found by itself have no Remove button.

Rescan at the top looks for folders again and reads every one.

Under Detection:

- Scan on startup looks for the usual folders the first time you open this page.
- Probe Zero-K / Steam also looks where Steam installs Zero-K.
- Fetch download lists in the background loads the map, game and engine lists after coilbox starts. Turn it off on a metered connection.

To keep everything in one folder next to coilbox, see [Portable mode](portable-mode.md).

## Download maps

1. Open Downloads > Maps in the sidebar.
2. Find a map. Type in Filter maps… to match part of its name.
3. Select Download on the map.

The list at the top left picks where the maps come from: springfiles, hakora, evolutionrts mirror, BAR Maps (GitHub) or TAP Maps (GitHub). Each one has different maps.

- The sort list beside the filter sorts by Name, Author, Largest map or Smallest map.
- Refresh loads the list again.
- Hide downloaded leaves out the maps you already have.
- A map you have shows Already downloaded.
- Show more at the bottom adds the next part of a long list.

## Download a map pack

A map pack is a set of maps you download in one go. It is the quickest way to get enough maps to start playing.

1. Open Downloads > Maps.
2. Select Map packs at the top of the page. A panel opens listing every pack, with how many of its maps you already have.
3. Select a pack to see its maps.
4. Select Download all. The number beside it is how many maps you still need.

You can also download one map from the pack with its own Download button. A pack you have every map from is marked Complete. The arrow at the top of the panel goes back to the list of packs.

![The Map packs panel open over the Maps download page. It lists Starter pack, Space maps and Classics as complete, then Resource Extremes and BAR maps with how many maps of each are downloaded.](/screenshots/map-packs.png)

To make a map pack of your own, see [Map packs](../developers/map-packs.md) in the game developer guides.

## Download games

1. Open Downloads > Games in the sidebar.
2. Pick where the games come from in the list at the top left.
3. Select Download on the game.

The sources are springfiles, coilbox hub, and a list for each game published on GitHub, such as SplinterFaction and Metal Factions. A game marked Latest is the newest version in that list.

Filter games…, the sort list, Refresh and Hide downloaded work as they do on the Maps page. Some sources can also sort by Newest and Oldest.

## Browse Rapid

Some games are not single files. They come as rapid packages, which download only the parts that changed since your last version. Beyond All Reason is one of them.

1. Open Downloads > Browse Rapid in the sidebar.
2. Pick a repository from the list at the top. Coilbox loads the games it holds.
3. Select a game on the left. Its versions appear on the right.
4. Select Download on the version you want.

Type in Filter repositories… or Filter versions… to find one in a long list.

Coilbox starts with one repository, called Spring. To add another, open Settings, then Library > Downloads. Select Add repository, then type its name and its master URL. The bin beside a repository removes it.

## Watch your downloads

While anything is downloading, the top bar shows how many downloads are running or waiting, and how far along the first one is. Select it to see each download's progress.

- The cross beside a running download cancels it.
- Downloads waiting their turn are listed under Queued. The cross beside one takes it out of the queue.

While a download runs, the other Download buttons say Add to queue. Coilbox tells you with a notification when each download finishes or fails.

## Install a file you already have

Game and map files end in `.sdz` or `.sd7`. To install one:

1. Drag the file onto the coilbox window. The window says "Drop to install".
2. Drop it. Coilbox asks whether to install it and says which folder it goes to.
3. Select Install.

Coilbox copies the file, so the one you dropped stays where it is. You can drop several files at once.

You can also open a `.sdz` or `.sd7` file with coilbox from your file manager.

## Engines

Every game runs on an engine. Different games, and different versions of one game, may need different engine versions.

Open Settings, then Library > Engines to see the engines you have, grouped by content folder.

- Singleplayer and other things you start yourself use your preferred engine, marked Preferred. If you have not picked one, it is the newest engine you have.
- Set preferred makes another engine your preferred one.
- Verify runs the engine to read its real version. Re-verify reads it again.
- Open shows the engine's folder on your computer.

A multiplayer battle or a replay uses the engine version it was made with. If you do not have that engine, coilbox offers to download it. See [Get the map and game](multiplayer.md#get-the-map-and-game) in the multiplayer guide.

### Install another engine

1. Open Settings, then Library > Engines.
2. Under Download an engine, pick a source from the list: Recoil (GitHub releases) or springfiles.
3. Select Install on the version you want.

The engine goes into the default folder from Content folders. If no folder is set, the page says so.

If the list says there are no builds for your machine, switch the source. On a Mac there may be no engine to download from either source. Then install one by hand:

1. Open Settings, then Library > Content folders.
2. Select Open on the folder you want the engine in.
3. Put the engine's own folder inside the `engine` folder there. Make a folder called `engine` if there is none.
4. Back in coilbox, select Re-scan on that content folder.

If no engine is installed at all, Singleplayer offers Download engine. See [What you need to start](singleplayer.md#what-you-need-to-start).

## Free up space

Open Settings, then Library > Storage. It shows what takes up space in each content folder.

- The table lists each kind of content, how many files it has and its size. The folder button on a row shows that folder on your computer.
- Reclaim space finds rapid package data that no game uses any more. It says how much it would free before you confirm. It is greyed out while a download runs.
- Replay cleanup deletes replays in bulk. Pick an age, or tick Already watched or Under 60 seconds, then select Delete matching. A deleted replay cannot be brought back.
- Engines lists each engine in the folder with its size. You can delete any engine except your preferred one.
- Caches holds pictures and details coilbox made from your games and maps. Reclaim caches clears them. Coilbox makes them again when it needs them.
- Replay tracks are the recordings that let you seek in a replay. See [Replay rewind](replay-rewind.md).

Refresh at the top measures every folder again.

## Import something you were sent

Open Settings, then Library > Import to bring in something another player shared, such as a campaign, a singleplayer preset, a scenario or a base blueprint.

1. Paste the coilbox link, code or file contents into the box. To use a file instead, select Open a file instead….
2. Select Import.

If what you import needs a game or map you do not have, coilbox lists it with a Download button before it saves anything.

## When a download fails

A failed download shows a red message under its Download button saying why. Coilbox also shows a "Download failed" notification.

Try these in order:

1. Select Download again.
2. Pick another source from the list at the top of the page. Another source may have the same map or game.
3. Check that the folder in Content folders still exists and that you can write to it.
4. If the page says no download folder is set, choose one in [Content folders](#choose-where-new-games-and-maps-go).

If a list does not load, a red message replaces it. Select Refresh to try again, or pick another source.

If a download finished but the game or map is not in the Library, see [When a game or map is missing](library.md#when-a-game-or-map-is-missing).
