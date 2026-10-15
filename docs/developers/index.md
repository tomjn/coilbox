# Game developer guides

Guides for people who make a game, a campaign, a map or a unit, and want coilbox to carry it to players. These are not guides to working on coilbox itself.

Most of the tools here are hidden until you turn on Advanced mode in Settings > General.

## Ship coilbox with your game

- [Package coilbox with your game](distributing.md). Lay out one zip per operating system with the engine, the game and maps inside, so a player unzips it and plays.
- [Distribution profiles](distribution-profile.md). The `profile.json` file that rebrands and narrows coilbox for your game without rebuilding it. Every field is listed, with examples.
- [Branding catalog](branding-catalog.md). Give your game its art, links and names for every coilbox user, including those who did not get a copy you packaged.
- [Map packs](map-packs.md). Offer a named list of maps as one download.

## Campaigns and missions

- [Campaigns](campaigns.md). Put skirmish missions in order, with briefings, media and unit restrictions, then export or bundle them.
- [Scenarios](scenarios.md). Author what happens inside the game: where units start, triggers, objectives and dialogue.
- [Mission runtime](mission-runtime.md). What a game adds to its archive so it can play scenarios, and how the runtime is tested.
- [Make a tutorial campaign](teaching-your-game.md). Go from writing lessons to a new player being offered the first one on the home page.

## Conquest and Warpath

- [Set up conquest for your game](conquest-for-your-game.md). Supply system names, factions and AI rankings, or bundle a galaxy.
- [Hand-made maps](hand-made-maps.md). Paint provinces in an image editor, describe them in `map.json`, and ship the map for Conquest and Warpath.

## Maps

- [Compile and decompile maps](mapping-tools.md). Build a map for the engine from your images with Mapping Tools, take an existing map apart, and check it in a 3D preview.

## Units

- [Unit builder](lego-builder.md). Assemble a unit from textured parts, animate it from a preset and write it into a game.
- [Unit tweaks](unit-tweaks.md). Change a game's units and weapons in a project, compare them in a table, test the result and package it as a game of its own or as tweak slot lines for a lobby.
- [Convert and compile unit scripts](animation-tools.md). Turn a BOS script into a Lua unit script, compile BOS to COB, and read a COB file back as source.

## Replays

- [Replay rewind for your game](replay-rewind.md). Write an adapter that switches off what fights a recording, bundle it in your archive, and read what the player logs.

## Tools

- [Browse archives and run Lua](archives.md). Look inside any game or map archive, save a file out of it, and run Lua with the archive loaded.

The [reference](../reference/index.md) section has the route list a profile points at and the file formats these tools read and write.
