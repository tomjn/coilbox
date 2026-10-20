# The Library

The Library is where your games and maps are, and where you get more of them. To play anything you need three things on your computer: an engine, a game and a map. The engine is the program that runs the game.

The Library in the sidebar has:

- Maps, which lists every map you have and every map the mirrors carry.
- Games, which lists every game you have and every game the Coilbox hub can fetch.
- Community, which is the Coilbox hub page. See [The Coilbox hub](hub.md).
- Blueprints. See [Base blueprints](blueprints.md).
- Downloads, which shows what is downloading and what you downloaded before.

Engines, the folders coilbox reads from and where downloads come from are in Settings, under Library.

Each installed map and game has its own page, and each game has a page for every unit in it.

## Which engine the Library uses

The Maps and Games pages read your content with your preferred engine. To use another engine, make it your preferred one in Settings, then Library > Engines. See [Engines](#engines).

Rescan, beside the page's heading, reads your content folders again, for example after you copy a map in. While it runs, it changes to Cancel scan.

## The Games page

Games shows the games you have installed and the games the Coilbox hub lists, in one grid. A game on your computer that the hub does not list is still shown.

Each game shows its art, its name and a line under the name:

- For an installed game, the line has its version and where it can be downloaded from, such as rapid or github.
- For a game you do not have, the line says where it can be downloaded from.
- "not on the hub" means the hub does not list the game.
- "no download source" means the hub lists the game but nothing can download it.

The badge at the top of a game says where it stands:

| Badge | What it means |
| --- | --- |
| Installed | You have the game. |
| Update, and a version number | You have the game, and a newer version is out. |
| Downloading | The game is downloading now. |
| Queued | The game is waiting for another download to finish. |
| Local | You have the game, and the hub does not list it. |

A game with no badge is one you can install.

The buttons on a game are:

- Play, which opens Singleplayer with that game picked.
- Install, which downloads a game you do not have.
- Update, which downloads the newer version.
- Cancel, which stops a download, or takes the game out of the queue.

Select anywhere else on an installed game to open its page. A warning icon on a game means something is wrong with it, for example an archive it depends on is missing. Open the game's page to read it.

To narrow the grid:

- Select a button at the top: My Games, New Games, Updates or Featured. Each one says how many games it holds. My Games is the games you have, and the page opens on it when you have any. New Games is the games you do not have, and the page opens on it when you have none. Featured is the games the hub features. Updates is the games with a newer version, and is hidden when there are none.
- Type in Search games… to match part of a game's name.
- Pick a sort from the list beside it: Featured first, Name A–Z or Name Z–A. Featured first is the default.

If the hub could not be read, a line above the grid says why. Your installed games are still listed.

### Install a game

1. Open Library > Games.
2. Find the game. Select New Games to see only the games you do not have.
3. Select Install.

Coilbox tries the download sources the hub gives for the game, in the hub's order. If you pinned a source for the game, it tries that one first. See [Sources](#sources). If the hub gives no source, coilbox downloads the newest version a mirror has.

A bar on the game shows how far the download has got. If it fails, the reason shows in red on the game. See [When a download fails](#when-a-download-fails).

### Update a game

When a newer version of a game you have is out, the game's badge says Update and the version. Select Update to download it. Your older version stays on your computer.

The top bar also shows how many updates there are, for example "2 updates". Select it to open the Games page. If the only update is a newer engine, it opens Settings, then Library > Engines.

To stop coilbox offering updates for one game, turn off Show updates on the game's page.

## A game's page

The banner at the top shows the game's art, its name and its version. Games at the top left goes back to the list. Play opens Singleplayer with this game picked.

Under the banner, a box sums up the game in your library:

- Installed is the version you have. If coilbox downloaded it, it also says where from and when.
- Update is the newer version on offer and where it comes from. Update beside it downloads it.
- Hub is how many factions and units the hub lists for the game.
- Engine is the engine the page reads the game with.
- Show updates decides whether coilbox offers updates for this game. Turn it off to keep the game off the Updates list and out of the count in the top bar.

The page has three tabs: Overview, Versions and Sources.

### Versions

Versions lists every version of the game that coilbox can download, and the versions you have. A tick marks an installed version. Each row has:

- Version, the version's name.
- Where from, the rapid tag or the GitHub repository it comes from.
- Kind, which says release, branch or snapshot, with its date and its size when the source gives them.
- Package, the package or file it is.
- Needs, the other archives it needs.

Select Install on a row to download that version. An installed version has a Delete button instead, which removes it from your computer after you confirm.

Some rapid games publish a version for every change. These commit snapshots are grouped under one row at the bottom. Its button says how many there are. Select it to list them, and select it again to hide them.

The line under the table says when coilbox last read the rapid list, and from where.

### Sources

Sources lists the places coilbox downloads this game from, in the order it tries them. Each row has:

- the source, such as Rapid, GitHub or Springfiles, and the mirror for a source with more than one
- Fetches, what it would download
- Last result, what happened the last time you downloaded from it: "not tried", "ok" with the date and how long it took, or "failed" with the date and the reason

To make coilbox try one source first for this game, select Use this on its row. A pin marks it. Coilbox then tries that source first when it installs the game, or downloads it for a battle. Update and the Install buttons on the Versions tab still download from the source they name. Unpin goes back to the usual order.

### Overview

Overview has everything else about the game.

The buttons at the top start a mode with this game already picked:

- Start a conquest opens [Galactic conquest](conquest.md).
- Start a warpath run opens [Warpath](warpath.md).

Links has buttons for the game's own website and other pages, when coilbox knows them.

Sides lists each faction in the game, with how many units it has and its starting unit.

- Build tree opens a chart of everything that faction's starting unit can build, directly or through what it builds. Point at a unit to light up what it builds and what builds it.
- Browse units opens the unit list showing only that faction.
- All units opens the list of every unit in the game.

A game that declares no factions shows Units instead, with All units beside it.

Under Sides:

- Metadata lists what the game says about itself.
- Your record by faction shows how often you won with each faction.
- Game options lists every setting the game offers. Select it to open it.
- Primary archive is the game's own file. Open folder shows it on your computer. Delete removes it after you confirm.
- Dependencies lists the other archives the game needs.

## The unit list

The unit list shows every unit in the game as a picture and a name, grouped by faction. Units that no faction can build are under Other units. A unit that upgrades in stages is listed once, with the number of upgrades under its name.

- Type in Search units… to find a unit by name. The count beside the box says how many match.
- Select a unit to open its page.
- Compare units opens the unit reference. See [Sort and compare units](#sort-and-compare-units).

The game's name at the top goes back to the game's page.

## A unit's page

The unit's 3D model is at the top. Drag to turn it. Back goes to the unit list.

Under the model are the unit's name, its faction and these sections:

- Renders shows the unit from the top, the front, the side and at an angle.
- The figures under them are its health, metal and energy cost, build time, sight distance and, for a unit that moves or shoots, speed and range. A unit with weapons has a table of each weapon's damage, reload, range and projectile.
- What it builds and What builds it link to those units' pages.
- Upgrades into, Can be upgraded from and Upgrade path show a unit's stages, and what it takes to reach each one.
- Where it can be built is for buildings. It gives the footprint, the steepest slope it can sit on, whether it floats and how deep the water can be.
- Model file names the model's file, its format and its size.

Edit in Unit tweaks opens Unit tweaks, where you can change this unit for your own games.

## Sort and compare units

Unit reference is a table of every unit in the game, with a chart above it. Open it with Compare units on the unit list.

- Select a column's name to sort by it. The columns are Name, Health, Metal cost, Build time, Sight, Speed, Range, DPS, Volley damage, Cost per HP, DPS per 100 metal, HP per build second and Range per cost. DPS is damage per second.
- Type a name in Search units… to find a unit. You can also search by a figure, for example hp > 3000, or speed < 50 and cost > 200.
- All factions narrows the table to one faction, in a game with more than one.

The chart puts every unit shown in the table as a dot. Pick what each axis shows from the two lists. Metal cost and DPS are the defaults. Log scale spreads out the small values when a few large ones squash them together.

To compare units side by side:

1. Tick the box at the start of two or more rows. The box in the header ticks every unit shown.
2. Select Compare in the bar above the table.

Compare units then opens beside the table. It shows only the figures where the units differ, one column for each unit. Clear in the bar unticks them all.

## The Maps page

Maps shows the maps you have installed and the maps the mirrors carry, in one grid. The mirrors are springfiles, hakora, evolutionrts, beyond-all-reason/Maps and FluidPlay/TAP-maps. A map on your computer that no mirror lists is still shown.

Each map shows its minimap, its name and a line under the name. The line has the map's size, how many start positions it has when the hub knows, and where it can be downloaded from. A map with more than two kinds of source says how many, for example "3 sources". "not on any mirror" means only your copy is known.

The badge at the top of a map says where it stands: Installed, Downloading, Queued or Local. Local means you have the map and no mirror lists it. A map with no badge is one you can install.

The buttons on a map are:

- Play, which opens Singleplayer with that map picked and keeps the rest of your setup.
- Install, which downloads a map you do not have.
- Cancel, which stops a download, or takes the map out of the queue.

Select anywhere else on an installed map to open its page.

To narrow the grid:

- Select a button at the top: My Maps, New Maps, 1v1, Team or Water. My Maps is the maps you have and New Maps is the maps you do not, and each says how many it holds. The page opens on My Maps when you have any maps, and on New Maps when you have none. 1v1, Team and Water look through every map.
- Type in Search maps… to match part of a map's name.
- Pick a sort from the list beside it: Name A–Z, Name Z–A, Largest or Smallest. Name A–Z is the default.

The grid shows 200 maps at a time. Show more at the bottom adds the next 200, and says how many are left.

1v1, Team and Water read what the hub knows about each map. 1v1 is a map with two start positions, or one tagged 1v1. Team is a map with four or more. Water is a map the hub tags as a water map. These buttons check the maps the grid has shown so far. If none of them match, the page says so, for example "No 1v1 maps in the first 200.", and Show more checks the next ones. The three buttons are not there when the hub is turned off.

While coilbox reads the mirrors, the page says "Reading the mirror indexes…". If a mirror could not be read, a line above the grid names it and says why. The maps from the other mirrors are still listed.

### Install a map

1. Open Library > Maps.
2. Find the map.
3. Select Install.

Coilbox asks each mirror that has the map in turn, so one mirror being down does not stop the download. A map that only a GitHub repository carries is downloaded from there.

### Download a map pack

A map pack is a set of maps you download in one go. It is the quickest way to get enough maps to start playing.

1. Open Library > Maps.
2. Select Map packs above the grid. It says how many packs still have maps for you to get. A panel opens listing every pack.
3. Select a pack to see its maps.
4. Select Download all. The number beside it is how many maps you still need.

You can also download one map from the pack with its own Download button. A pack you have every map from is marked Complete. The arrow at the top of the panel goes back to the list of packs.

To make a map pack of your own, see [Map packs](../developers/map-packs.md) in the game developer guides.

### Import a setup pack

A setup pack is a list of games and maps someone shared, which can carry some presets too. When you open a coilbox link for one, the Maps page opens with a panel called Import a setup pack, and the pack's code already filled in. See [Share a setup pack](hub.md#share-a-setup-pack).

## A map's page

The name and size are at the top, with the map's own description under them. Maps above the name goes back to the list.

The buttons under the name are:

- Play this map, which opens Singleplayer with this map picked.
- Host a battle here, which opens Battles with the form for hosting a battle open and this map picked. See [Host a battle on a server](multiplayer.md#host-a-battle-on-a-server).
- Replays on this map, which opens Replays showing only matches on this map.
- Delete, which removes the map's file from your computer after you confirm. It does not appear for a map that came with the engine.

### Your record on this map

This shows your own games on the map: how many you played, your win rate, when you last played it and the faction you won with most. Until you have played the map it says "No replays recorded on this map yet."

### Preview

The heading says how many start positions the map has. Each start position is a dot on the minimap. Point at a dot to see its number, or the name you gave it.

- Map, Metal and Height change what the minimap shows. Metal shows where the metal is. Height shows the high and low ground.
- Beside the minimap is a 3D view of the map. Drag to turn it.
- Water and Wireframe turn the water and a wire outline of the ground on and off.
- Fullscreen preview opens the 3D view on its own.

### How this map is played

This section draws every match on this map from your replays as one picture. Until a replay on this map is in your library it says "No match on this map is in your library yet."

The line under the heading says how many matches are in the picture, and how many of them have been analysed. See [Analyse a replay](replays.md#analyse-a-replay).

To choose which matches go in:

- Versions of this map lists other versions of the map you have replays on. Tick the ones to include. A version can have a different layout, so its starts and counts may land in the wrong place.
- Games and versions lists the games those matches were played in. Untick a game to leave its matches out.
- The lists under them narrow the picture by number of players, by how the sides were arranged, and by whether a match was analysed.
- Played from and Played until limit the picture to a range of dates.
- Matches under a minute adds the very short matches, which are left out at first.
- Clear filters puts every choice back.

To choose what the picture shows:

- Start positions puts a dot where each player started.
- Building density, Defences, Economy, Order density and Deaths each colour the map by where that happened most. The number on each button is how many matches have it. Deaths needs analysed matches.
- The first list under the buttons decides how the matches are added together: Share of each match, Each match's busiest spot or Per minute of match.
- The second list limits the picture to part of every match, such as First 5 minutes. Between two minutes lets you type your own range.

Export picture saves the picture as an image. Export layer CSV and Export start positions CSV save the figures for a spreadsheet.

What your library knows about it sums up the same matches. It shows which team won, how long a match runs here compared with your other maps, how each start position did and which factions won here. Type in Name this place beside a start position to give it a name. The name then shows on the minimap.

### Warpath and Galactic Conquest

Turn on Hide this map to keep the map out of warpaths and conquests that coilbox makes for you. You can still play it in Singleplayer and in multiplayer. If the switch is already on and greyed out, the map has been left out for you, and the line beside it says why.

### Metadata, map options and archives

Metadata lists what the map says about itself, such as its author. Map options lists the settings the map offers, if it has any. Archives lists the files the map is in, including any other archive it needs.

## Watch your downloads

While anything is downloading, the top bar shows how many downloads are running or waiting, and how far along the first one is. Select it to see each download's progress.

- The cross beside a running download cancels it.
- Downloads waiting their turn are listed under Queued. The cross beside one takes it out of the queue.
- All downloads at the bottom opens Library > Downloads.

Coilbox tells you with a notification when each download finishes or fails.

### The Downloads page

Library > Downloads lists what is downloading, then what is waiting, then everything that finished, newest first. It keeps the downloads from before you last closed coilbox too.

Each row has the item's name and whether it is a map, a game, an engine or a file, the source it came from, and how far it got.

- Select a button at the top to see All, Downloading, Failed or Done. Failed includes downloads you cancelled.
- Type in Search downloads… to find one by name.
- Sort by Newest first or Name.

The buttons on a row are:

- Cancel, on a running download.
- Remove from queue, on a waiting one.
- Show in Maps or Show in Games, on a finished map or game.
- Log, on a failed or cancelled download. It opens a panel with the full error and each source coilbox tried, with what happened there.

A download tries each of its sources in turn, and only fails once the last one has failed. So a failed download has nothing left to try. If you cancel a download before it reaches its last source, its row offers the next one. The button says Try next mirror, Try pr-downloader for a map, or Try and the source's name, such as Try GitHub. Only downloads you cancelled since coilbox started have this button.

## When a download fails

A failed download shows the reason in red on the game or map. Coilbox also shows a "Download failed" notification.

Try these in order:

1. Open Library > Downloads and select Log on the download. It says what each source said.
2. Select Install again. A mirror that was down may be back.
3. Check that the folder in Content folders still exists and that you can write to it.
4. If the page asks you to set a download folder, choose one. See [Choose where new games and maps go](#choose-where-new-games-and-maps-go).

If a download finished but the game or map is not in the Library, see [When a game or map is missing](#when-a-game-or-map-is-missing).

## Install a file you already have

Game and map files end in `.sdz` or `.sd7`. To install one:

1. Drag the file onto the coilbox window. The window says "Drop to install".
2. Drop it. Coilbox asks whether to install it and says which folder it goes to.
3. Select Install.

Coilbox copies the file, so the one you dropped stays where it is. You can drop several files at once.

You can also open a `.sdz` or `.sd7` file with coilbox from your file manager.

## Choose where new games and maps go

Coilbox looks for games, maps and engines in your content folders. It finds the usual ones by itself, for example the folder another lobby already uses.

To see them, open Settings, then Library > Content folders.

The top of the page, New content goes to, decides where downloads are saved:

- Default is the folder new games, maps and engines go to.
- Games and Maps can each send that kind somewhere else. Same as default keeps them with everything else.

Each folder below has labels saying what goes there, such as "new content goes here". It also shows how many engines, maps, games and packages it holds.

If the Maps or Games page asks you to set a download folder, pick one here.

### Add a content folder

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

## Sources

Open Settings, then Library > Sources. It has:

- Rapid repositories, the rapid servers listed on the Rapid repositories page. See [Advanced mode](settings.md#advanced-mode).
- Download missing content automatically, under Joining a battle. When it is on, joining a battle whose game or map you do not have starts the download straight away. See [Get the map and game](multiplayer.md#get-the-map-and-game).
- Your hub address, under Coilbox hub, to point coilbox at a different hub. Leave it blank to use the default. Clear override puts it back.

## Engines

Every game runs on an engine. Different games, and different versions of one game, may need different engine versions.

Open Settings, then Library > Engines to see the engines you have, grouped by content folder.

- Singleplayer, the Library and other things you start yourself use your preferred engine, marked Preferred. If you have not picked one, it is the newest engine you have.
- Set preferred makes another engine your preferred one.
- Verify runs the engine to read its real version. Re-verify reads it again.
- Open shows the engine's folder on your computer.

When a newer engine is out, the page says "Newer engine available" and its version.

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

To remove one game or map, use Delete on its page.

## Import something you were sent

Open Settings, then Library > Import to bring in something another player shared, such as a campaign, a singleplayer preset, a scenario or a base blueprint.

1. Paste the coilbox link, code or file contents into the box. To use a file instead, select Open a file instead….
2. Select Import.

If what you import needs a game or map you do not have, coilbox lists it with a Download button before it saves anything.

## When a game or map is missing

The Library lists what the engine finds in your content folders. If a game or map you know is on your computer is not listed, try these in order.

1. Select Rescan at the top of the page. It reads your content folders again, for example after you copy a map in.
2. If you have more than one engine, the Library reads your content with your preferred one. Make another engine preferred in Settings, then Library > Engines, and look again.
3. Check that its folder is one of your content folders. Open Settings, then Library > Content folders, select Add folder and pick the folder that holds your games and maps folders.

If the list could not be read, the page says "The scan failed, so no maps are listed", or games, and gives the reason. Your files are still on disk.

If the last scan was saved but the new one has not finished, the page shows the saved list with Checking above it. If the new scan fails, it says "This list could not be checked" and turns playing off until a scan works.

If no engine is installed, the page says so and links to Content folders and Engines.

With no games or maps at all and nothing from the hub or the mirrors, the Games and Maps pages suggest some to download.
