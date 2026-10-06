# Sample hand-made map

Two Shores is a small, complete hand-made map for Conquest and Warpath. Copy this folder to start your own map. Coilbox's tests read it too, so it always matches what the reader accepts.

The map has nine painted provinces on two land masses with sea between them, and one city. The Western League and the Eastern Crown hold a capital each, and the other provinces are neutral. Westhaven is the Warpath start and Farwatch is the goal.

## The files

`map.json` is the manifest. It names the map, the game it is for, its size, its files, its factions, its provinces and everything that joins them. JSON has no comments, so this README explains it.

`picture.png` is the map picture the player sees. `size` in the manifest is the size of the map in map units, and every position is measured on it.

`provinces.png` is the province image. Each province is painted in one flat colour, and `provinces[].color` in the manifest lists that colour. Sea is transparent, so it belongs to no province. Neighbours are the provinces that touch.

`heightmap.png` is the optional heightmap named by `files.heightmap`. Black is lowest and white is highest, and `heightScale` is how high white is in map units.

`towns` in the manifest is set to `true`, so coilbox paints a town at each location, fields round them and roads between neighbouring provinces' towns. Without it the map shows only the picture and the listed roads.

`cairn.gltf` is the placed model that comes from a file. The `models` list stands it on the terrain at `pos`, turned by `rotation`. The file is one `.gltf` with its data inside, so there is nothing else to copy.

`ironcoast-siege.json` is a scenario, exported by the scenario builder's own export code from the Splinter Faction fixture in `src/scenario/fixtures/splinter.json`. Ironcoast names it in its `scenario` field, so the player plays it in place of a skirmish the first time they attack there.

## What the manifest shows

Provinces have an `owner`, a `difficulty` and a `blurb`. Westhaven and Farwatch have `capital` set to true, which each faction needs exactly once. Westhaven and Farwatch also have a `battle`, which names the skirmish map. Both use `AcidicQuarry 5.17`. A province with no `battle` has one picked from the player's maps by its difficulty.

`locations` holds point locations, which have a `pos` and no painted area. Stonebridge is the sample's city. A point location joins the map through `roads`.

`crossings` joins two locations that do not touch. Eastcliff and Ironcoast are on different land masses, so the crossing is the only way across the sea.

`blockedBorders` lists locations that touch but cannot be moved between. Northmarch and Midvale are blocked, and a ridge in the heightmap follows that border.

`warpath` gives the `start` and the `goal`, as location ids. A `warpath` field on a location gives its `kind`. Eastcliff is a shop and Ironcoast is a battle.

A location id is its name in lower case, so Northmarch is `northmarch`. Set `id` by hand if you rename a location and want saved games to keep their place.

## The heightmap

The heightmap writes six land values from 36 to 219 out of 255, and sea is 0. With `heightScale` 120, the land stands between 17 and 103 map units high. The hills rise inland, and a ridge runs along the Northmarch and Midvale border.

## The game and the models

The sample is for Splinter Faction, the game whose modinfo shortname is `SF`. The map names the game by shortname alone and pins no archive name, so it keeps working when the game updates. Coilbox picks the newest installed Splinter Faction.

To point the sample at another game, change `game.shortname` in `map.json` to that game's shortname. Then change three more things:

1. The `battle` fields name skirmish maps, so change them to maps the new game's players have.
2. The `game` model in `models` names `ammobox`, so change it to a model name the new game ships.
3. The scenario is for Splinter Faction, and a scenario must be for the same game as the map. Export your own from the scenario builder and name it in `scenario`. Its units, sides and map are Splinter Faction's, so they would not work in another game even if the file were accepted.

The placed models are of two kinds. `cairn.gltf` is a file in this folder. `{ "game": "ammobox" }` is a model the game ships. The name can be a path inside the game archive, a model file name, a unit name or a feature name the game defines, tried in that order. `ammobox` is a Splinter Faction feature, and it is scenery, which is what an author would place. It was resolved against a real Splinter Faction install in #3607, through the same reader the map uses. That check was not made in the app.

What the sample could not confirm for Splinter Faction:

- `AcidicQuarry 5.17` is the only skirmish map this repository names for the game, so Westhaven and Farwatch share it.
- The scenario's units, sides and map come from the Splinter Faction fixture that the repository's engine proof scripts use. The scenario as exported here has not been played in the app.
- The scenario names the game `SplinterFaction`, with no version. A conquest or a run plays it on the installed build.

## Where the art comes from

Nobody drew these files in an image editor. `scripts/build-sample-handmade-map.mjs` draws `picture.png`, `provinces.png`, `heightmap.png` and `cairn.gltf` from numbers in the script, so the art was made for this repo and has no outside licence. `map.json` is written by hand. `ironcoast-siege.json` is not drawn by the script. It is the scenario fixture run through the scenario builder's export code. If you change a province colour in the script, change it in `map.json` too. Run the script with `bun scripts/build-sample-handmade-map.mjs`.
