# Sample hand-made map

Two Shores is a small, complete hand-made map for Conquest and Warpath. Copy this folder to start your own map. Coilbox's tests read it too, so it always matches what the reader accepts.

The map has nine painted provinces on two land masses with sea between them, and one city. The Western League and the Eastern Crown hold a capital each, and the other provinces are neutral. Westhaven is the Warpath start and Farwatch is the goal.

## The files

`map.json` is the manifest. It names the map, the game it is for, its size, its files, its factions, its provinces and everything that joins them. JSON has no comments, so this README explains it.

`picture.png` is the map picture the player sees. `size` in the manifest is the size of the map in map units, and every position is measured on it.

`provinces.png` is the province image. Each province is painted in one flat colour, and `provinces[].color` in the manifest lists that colour. Sea is transparent, so it belongs to no province. Neighbours are the provinces that touch.

`heightmap.png` is the optional heightmap named by `files.heightmap`. Black is lowest and white is highest, and `heightScale` is how high white is in map units.

`cairn.gltf` is the placed model. The `models` list stands it on the terrain at `pos`, turned by `rotation`. The file is one `.gltf` with its data inside, so there is nothing else to copy.

`ironcoast-siege.json` is a scenario, exported from the scenario builder. Ironcoast names it in its `scenario` field, so the player plays it in place of a skirmish the first time they attack there.

## What the manifest shows

Provinces have an `owner`, a `difficulty` and a `blurb`. Westhaven and Farwatch have `capital` set to true, which each faction needs exactly once. Westhaven and Farwatch also have a `battle`, which names the skirmish map. A province with no `battle` has one picked from the player's maps by its difficulty.

`locations` holds point locations, which have a `pos` and no painted area. Stonebridge is the sample's city. A point location joins the map through `roads`.

`crossings` joins two locations that do not touch. Eastcliff and Ironcoast are on different land masses, so the crossing is the only way across the sea.

`blockedBorders` lists locations that touch but cannot be moved between. Northmarch and Midvale are blocked, and a ridge in the heightmap follows that border.

`warpath` gives the `start` and the `goal`, as location ids. A `warpath` field on a location gives its `kind`. Eastcliff is a shop and Ironcoast is a battle.

A location id is its name in lower case, so Northmarch is `northmarch`. Set `id` by hand if you rename a location and want saved games to keep their place.

## The heightmap

The heightmap writes six land values from 36 to 219 out of 255, and sea is 0. With `heightScale` 120, the land stands between 17 and 103 map units high. The hills rise inland, and a ridge runs along the Northmarch and Midvale border.

## The game and the models

The sample is for the game with `game.shortname` `TG`, a test game. To point it at another game, change `game.shortname` in `map.json`. The `battle` fields name maps, so change those to maps the new game's players have. The scenario was exported for `TG`, and a scenario must be for the same game as the map, so export your own from the scenario builder and name it in `scenario`.

The sample has no model of the `game` kind, which would be `{ "game": "<name>" }` in `models`. The name can be a path inside the game archive, a model file name, a unit name or a feature name the game defines, tried in that order. No model name for `TG` can be confirmed from this repository, so none is listed. Issue #3597 tracks adding one.

## Where the art comes from

Nobody drew these files in an image editor. `scripts/build-sample-handmade-map.mjs` draws `picture.png`, `provinces.png`, `heightmap.png` and `cairn.gltf` from numbers in the script, so the art was made for this repo and has no outside licence. `map.json` and `ironcoast-siege.json` are written by hand. If you change a province colour in the script, change it in `map.json` too. Run the script with `bun scripts/build-sample-handmade-map.mjs`.
