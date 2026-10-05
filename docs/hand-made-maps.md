# Hand-made maps

A hand-made map is a folder that holds a text file and two or three images. You paint the provinces in an image editor and describe them in `map.json`. Coilbox reads the folder into a map of land for [Conquest](conquest.md) and [Warpath](roguelite-run.md), with provinces, cities, borders and roads. There is no map editor.

This guide takes you from an empty folder to a map a player can play. It follows the sample map, so open the sample beside it.

## Start from the sample

The sample map is in the coilbox repository at [`docs/examples/handmade-map`](https://github.com/tomjn/coilbox/tree/main/docs/examples/handmade-map). Copy the folder and change it. It holds these files.

| File | What it is |
| --- | --- |
| `map.json` | The manifest. It names the other files and lists the factions, provinces and links. |
| `picture.png` | The map picture the player sees. |
| `provinces.png` | The province image. Each province is one flat colour. |
| `heightmap.png` | A greyscale image that raises the land. Optional. |
| `cairn.gltf` | A model stood on the land. Optional. |
| `ironcoast-siege.json` | A scenario played in place of a skirmish. Optional. |
| `README.md` | A walk through the files. |

The manifest must be called `map.json`. The images can have any name, because the manifest names them in `files`.

The sample is small. Its three images are 160 by 96 pixels and its `size` is 1600 by 960, so one pixel is 10 map units. It has two land masses with sea between them, nine provinces, two factions and one city. It is for a test game with the shortname `TG`. Change `game.shortname` to your game's before you try it.

`scripts/build-sample-handmade-map.mjs` draws the sample's picture, province image, heightmap and model, so you can read how each one is made.

## Map units and positions

Every position in the manifest is in map units. `size` sets how many map units wide and high the map is.

- The origin is the top left of the map picture.
- `x` runs to the right and `y` runs down.
- A position is written as `[x, y]`, for example `[400, 640]`.
- A position must be inside the map, from 0 to the width and from 0 to the height.

The reader scales the province image to the map. A pixel at column 40 of an image 160 pixels wide, on a map 1600 units wide, is at `x` 400.

## Paint the province image

The province image says which part of the map belongs to which province.

1. Make it the same size in pixels as the map picture. The reader refuses the folder if the two sizes differ.
2. Paint each province in one flat colour. No two provinces can share a colour.
3. Leave everything that is not a province transparent. Sea in the sample is transparent.
4. Write each province's colour in `map.json` as `#rrggbb`. The colour must match exactly.
5. Save it as a PNG. A format that loses detail, such as JPEG, changes the colours.

If your image editor cannot save transparency, pick one colour for the unpainted area and name it in `background`. A pixel of exactly that colour belongs to no province.

Two provinces are neighbours when their painted areas share a pixel edge. Two areas that meet only at a corner are not neighbours.

### Soft edges

Brushes and resizing blend colours along an edge. The blended pixels match no province. The reader settles them like this. The numbers are the constants `ALPHA_PAINTED`, `EDGE_SOFTNESS` and `SPECK_PIXELS` in `src/conquest/handmade/trace.ts`.

- A pixel is painted when its alpha is 128 or more out of 255. A fainter pixel is unpainted.
- A painted pixel whose colour is not listed, and is not the background colour, is unsettled.
- The reader makes 2 passes. In each pass an unsettled pixel that sits beside a settled pixel takes the settled neighbour whose colour is nearest to its own. Neighbours are the pixels above, below, left and right.
- With a `background` colour, the unpainted area competes like a province. Without one, an unsettled pixel becomes unpainted only when no province is beside it.

Each pass works in from both sides. So a blended seam up to 4 pixels wide disappears. A patch of unlisted colour 5 pixels across keeps its middle pixel, and the reader reports it as a colour that is painted but not listed. The comment beside `EDGE_SOFTNESS` says this is reasoned from how blending works and is not measured against particular image editors.

### Stray pixels

A separate piece of a province smaller than 9 pixels is treated as a slip. The reader gives it to whatever it shares the most pixel edges with, which can be another province or the unpainted area.

The largest piece of a province is always kept, however small. A province that is one tiny island still reads.

### A province in two pieces

A province can be painted in more than one piece, such as a mainland and an island. Paint every piece in the same colour.

- Each piece of 9 pixels or more is kept as part of the province.
- The province's marker goes in the largest piece, unless you set `anchor`.
- A neighbour that touches any piece is a neighbour of the province.
- Pieces do not need to touch each other. The province is one location.

### Outlines and markers

The reader traces the outer edge of each piece and straightens it. The traced outline stays within 1 pixel of the painted edge (`SIMPLIFY_TOLERANCE`), so a sloped edge painted as a staircase becomes a straight line. A hole inside a piece is not traced.

By default a province's marker sits at the centre of the pixel deepest inside its largest piece. Set `anchor` on the province to put it somewhere else.

## The manifest

`map.json` is one JSON object. Two rules hold for every part of it.

- A key the reader does not know is ignored.
- A value the reader does not know is an error. A typing mistake in an owner or a colour is reported, not guessed at.

### A complete example

This is the sample's `map.json`.

```json
{
  "formatVersion": 1,
  "id": "sample-two-shores",
  "title": "Two Shores",
  "description": "A small sample map: two land masses, a strait between them, and a faction on each side.",
  "game": { "shortname": "TG" },
  "size": { "width": 1600, "height": 960 },
  "files": {
    "picture": "picture.png",
    "provinces": "provinces.png",
    "heightmap": "heightmap.png"
  },
  "heightScale": 120,
  "factions": [
    { "id": "west", "name": "Western League", "color": "#d9a441" },
    {
      "id": "east",
      "name": "Eastern Crown",
      "color": "#3fa374",
      "aggression": 0.4
    }
  ],
  "playerFaction": "west",
  "provinces": [
    {
      "color": "#c85050",
      "name": "Northmarch",
      "difficulty": 2,
      "blurb": "Hill country north of the ridge."
    },
    {
      "color": "#d9a441",
      "name": "Westhaven",
      "owner": "west",
      "capital": true,
      "battle": { "mapName": "MapA" }
    },
    { "color": "#7ab85a", "name": "Midvale", "owner": "west" },
    {
      "color": "#4f9da6",
      "name": "Eastcliff",
      "difficulty": 2,
      "warpath": { "kind": "shop" }
    },
    { "color": "#8a6fc2", "name": "Southreach" },
    {
      "color": "#b55f9a",
      "name": "Ironcoast",
      "difficulty": 3,
      "blurb": "The keep that guards the landing. Taking it is a scenario, not a skirmish.",
      "scenario": "ironcoast-siege.json",
      "warpath": { "kind": "battle" }
    },
    { "color": "#5c7fd0", "name": "Highmoor", "difficulty": 3 },
    {
      "color": "#c97b3c",
      "name": "Redfield",
      "owner": "east",
      "difficulty": 4
    },
    {
      "color": "#3fa374",
      "name": "Farwatch",
      "owner": "east",
      "capital": true,
      "difficulty": 5,
      "battle": { "mapName": "MapB", "enemyAiCount": 2 }
    }
  ],
  "locations": [
    {
      "name": "Stonebridge",
      "pos": [400, 640],
      "difficulty": 2,
      "blurb": "A walled town on the road south."
    }
  ],
  "crossings": [["eastcliff", "ironcoast"]],
  "blockedBorders": [["northmarch", "midvale"]],
  "roads": [["stonebridge", "midvale"], ["stonebridge", "southreach"]],
  "warpath": { "start": "westhaven", "goal": "farwatch" },
  "models": [
    { "model": { "file": "cairn.gltf" }, "pos": [440, 600], "rotation": 30 }
  ]
}
```

### Top level

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `formatVersion` | number | Yes | Always `1`. |
| `id` | text | Yes | Letters, digits and `-`. Saved games record it, so do not change it once players have the map. |
| `title` | text | Yes | The map's name. |
| `description` | text | No | A sentence or two about the map. |
| `game` | object | Yes | The game the map is for. See [Game](#game). |
| `size` | object | Yes | `width` and `height` in map units. Each is a number above 0. |
| `files` | object | Yes | The file names of the images. See [Files](#files). |
| `heightScale` | number | No | How high a white heightmap pixel is, in map units. A number above 0. See [The heightmap](#the-heightmap) for the default. |
| `background` | colour | No | `#rrggbb` of a colour that belongs to no province. No default. |
| `factions` | list | Yes | At least one faction. See [Factions](#factions). |
| `playerFaction` | text | No | The id of the faction picked by default. It must be a faction the player can pick. Defaults to the first one the player can pick. |
| `provinces` | list | Yes | The painted provinces. See [Provinces and locations](#provinces-and-locations). |
| `locations` | list | No | Point locations, such as cities. |
| `crossings` | list of pairs | No | See [Crossings, blocked borders and roads](#crossings-blocked-borders-and-roads). |
| `blockedBorders` | list of pairs | No | See the same section. |
| `roads` | list of pairs | No | See the same section. |
| `warpath` | object | No | The start and the goal of a Warpath run, as `start` and `goal`. See [Warpath markings](#warpath-markings). |
| `models` | list | No | Models stood on the land. See [Placing models](#placing-models). |

The map needs at least one location. `provinces` must be present, and `provinces` and `locations` cannot both be empty.

### Game

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `shortname` | text | Yes | The `shortname` in the game's modinfo. |
| `pinnedName` | text | No | The exact archive name of one version of the game. A scenario on the map is checked against it. |

### Files

Each value is the name of a file inside the map folder. It can be a path into a folder inside the map folder, written with `/`. It cannot start with `/`, contain a backslash, contain a `..` step, or be a URL.

| Key | Required | What it is |
| --- | --- | --- |
| `picture` | Yes | The map picture shown to the player. |
| `provinces` | Yes | The province image. It must be the same size in pixels as the picture. |
| `heightmap` | No | A greyscale image, black lowest and white highest. |

### Factions

Each entry in `factions` is an object.

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `id` | text | Yes | A short id that provinces use as their `owner`. It cannot be `neutral`. Two factions cannot share one. |
| `name` | text | Yes | The name shown to the player. |
| `color` | colour | Yes | `#rrggbb`. The tint on the map and the team colour in battle. |
| `aggression` | number | No | From 0 to 1. How often this faction attacks when the computer plays it. |
| `aiKey` | text | No | The skirmish AI that plays this faction, as `kind:shortName`. |
| `side` | text | No | The in-game side this faction plays, such as "Core". |
| `playable` | true or false | No | Whether the player may pick this faction. Defaults to true. |

At least one faction must be one the player can pick.

### Provinces and locations

A province is painted on the province image. A point location has a position and no painted area. A city is a point location. Both take these keys.

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `name` | text | Yes | The name shown to the player. |
| `id` | text | No | The id that crossings, blocked borders, roads, Warpath markings and saved games use. Letters, digits, `-` and `_`. See below for the default. |
| `owner` | text | No | A faction id, or `neutral`. Defaults to `neutral`. |
| `capital` | true or false | No | True for a faction's capital. A capital needs an owner. |
| `difficulty` | whole number | No | From 1 to 5. How hard the battle is. Defaults to 1. |
| `battle` | object | No | The battle fought here. See [Battle](#battle). |
| `blurb` | text | No | A sentence or two about the location. |
| `warpath` | object | No | What the location is on a Warpath run, as `kind`. See [Warpath markings](#warpath-markings). |
| `scenario` | text | No | The name of a scenario file in the folder, played in place of a skirmish. See [Giving a location a scenario](#giving-a-location-a-scenario). |

A province also takes these.

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `color` | colour | Yes | `#rrggbb`, the one flat colour the province is painted in. It cannot be the `background` colour, and two provinces cannot share one. Upper and lower case letters read the same. |
| `anchor` | position | No | Where the province's marker sits, as `[x, y]`. Defaults to a point well inside the painted area. |

A point location also takes this.

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `pos` | position | Yes | Where it is, as `[x, y]`. |

The default `id` is the name in lower case, with every run of other characters turned into one `-`. "Lower Saxony" becomes `lower-saxony`. Two rules follow from that.

- Set `id` by hand before you rename a location, so saved games keep their place. A location whose id changes starts again from the manifest's owner, so a capture of it is lost.
- No two locations can end up with the same id. Provinces and point locations share one set of ids.

Each faction needs exactly one capital. That includes a faction the player cannot pick. A capital can be a province or a point location.

### Battle

Leave `battle` out when you do not need a particular map. Coilbox then picks a battle map from the maps the player has, by the location's difficulty, when the player starts a conquest. The pick is saved with the conquest, so a location keeps its battlefield.

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `mapName` | text | Yes | The name of the map the battle is fought on. |
| `enemyAiCount` | whole number | No | From 1 to 8. How many enemy AIs. By default it comes from the difficulty. |
| `enemyAiKey` | text | No | The skirmish AI for this location's enemies, as `kind:shortName`. |
| `startPosType` | whole number | No | 0 or above. The battle's start position type. |
| `handicap` | whole number | No | From 0 to 300. The enemy team's handicap as a percentage. By default it comes from the difficulty. |
| `mapDownload` | object | No | Where to get the map when its download name differs from its name. It needs a `springName` or a `searchUrl`. |
| `modOptionValues` | object | No | Game option names and their values. Every value is text. |
| `disabledUnits` | list of text | No | Internal names of units the battle forbids. |

## Crossings, blocked borders and roads

The reader works out neighbours from the paint. Three lists in the manifest change that. Each list holds pairs of location ids, such as `["kent", "calais"]`.

| List | What a pair does |
| --- | --- |
| `crossings` | Joins two locations that do not touch, such as the two sides of a strait. |
| `blockedBorders` | Stops movement between two provinces that touch, such as across a mountain ridge. |
| `roads` | Joins two locations by a road. This is how a point location joins the map. |

These rules apply.

- Every id in a pair must be the id of a location. Remember the default id is made from the name.
- A pair cannot join a location to itself.
- A blocked border must be between two provinces that touch on the province image.
- A pair cannot be both blocked and joined by a crossing or a road.
- A crossing or a road along an open border changes that link's kind. It does not add a second link.
- A pair listed as both a crossing and a road is a road.

A point location has no painted area, so it has no neighbours of its own. Give it at least one road or crossing.

### Every location must be reachable

The reader joins locations through open borders, crossings and roads. It takes the largest group of joined locations as the main body of the map. It reports every location outside that group.

To fix a location that cannot be reached, add a crossing or a road to it. For a province you can also repaint it so it touches a neighbour.

The reader skips this check while a colour is painted but not listed, a province is listed but not painted, or a pair names an unknown location. Each of those makes provinces look cut off when they are not. So fixing one of them can bring out a "cannot be reached" message on the next read. The Warpath route check is skipped in the same cases.

## The heightmap

The heightmap is optional. Without one the map is flat.

- Black is ground level, height 0.
- White is `heightScale` map units high.
- A grey in between is in proportion. A pixel's value from 0 to 1 is multiplied by `heightScale`.
- Without `heightScale`, white is 0.05 of the map's longer side. This is `DEFAULT_HEIGHT_SCALE_FRACTION` in `src/conquest/galaxy3d/terrain.ts`. A map 1000 units wide gets peaks 50 units tall.

The sample sets `heightScale` to 120 on a map 1600 units wide.

Coilbox reads the red channel of the image, at 256 levels. A 16 bit image is read at 256 levels too. Save a greyscale image so that red, green and blue agree.

The heightmap is stretched over the whole map. The first and last pixels of each row and column sit on the map's edges, and heights between pixels are blended. The reader does not check the heightmap's size, so it does not have to match the picture.

The terrain is drawn with at most 256 steps along the map's longer side (`TERRAIN_MAX_SEGMENTS`). A heightmap with more pixels than that on its longer side is sampled at those steps, so the extra pixels add little.

If `map.json` names a heightmap that is not in the folder, the reader reports it. A heightmap that is in the folder but cannot be opened as an image is reported too.

## Placing models

The `models` list stands models on the land as scenery. A model is not a location, cannot be selected and has no effect on the rules. Each entry is an object.

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `model` | object | Yes | Which model. Either `{ "game": "NAME" }` or `{ "file": "FILE" }`, never both. |
| `pos` | position | Yes | Where it stands, as `[x, y]` in map units. |
| `height` | number | No | The height of the model's origin in map units above zero. Without it the model stands on the ground at `pos`. |
| `rotation` | number | No | Degrees about the vertical axis, anticlockwise seen from above. 90 turns a model that faced the bottom of the picture to face its right. |
| `scale` | number | No | A size multiplier above 0. At 1, the default, one unit of the model is one map unit. |

Coilbox cannot know how big a model should be against your map, so set `scale` to suit it.

A `file` model is a `.gltf` or `.glb` file in the map folder, with a path written with `/`. A `.gltf` can keep its `.bin` and texture files beside it, in the folder or a folder inside it. Coilbox reports a `.gltf` whose `.bin` or texture is missing, or points outside the folder, when it reads the map. A model with its data inside the file, as `cairn.gltf` has, needs nothing else.

A `game` model is one the game ships. The name can be a whole path inside the game archive, such as `features/pinetree.s3o`, a model file name with or without its extension, a unit name or a feature name, tried in that order. A model the game does not ship is looked for in the archives the game depends on, in the engine's order, and then in the engine's base content, as the engine does. So a game built on another game draws that game's models, and the engine's default trees `treetype0` to `treetype15` draw. A file the game ships wins over a dependency's file of the same name, and a dependency's wins over base content. The sample uses no `game` model, because the repository has no model name to confirm for its game.

If a model cannot be loaded when the map is drawn, the rest of the map still draws, and the failure is written once to the console for each name.

## Warpath markings

A map is offered in Warpath only when the manifest has a `warpath` object with both `start` and `goal`. A map without it is for Conquest only. Conquest ignores the markings and uses every location.

```json
"warpath": { "start": "westhaven", "goal": "farwatch" }
```

`start` and `goal` are location ids. They must be two different locations, and the goal must be reachable from the start.

A run on a hand-made map is drawn in the Theatre style, and the map decides how long it is, so the run setup has no length choice. The run starts at the start, crosses the map one location at a time and ends at the goal, with no way back.

### How the route works

Coilbox ranks every location by how many links it is from the start. A run keeps a step only when it goes to a neighbour one rank further on. A location that is on no such route to the goal is scenery. It is drawn but has no fight and cannot be chosen. A link between two locations of the same rank cannot be travelled and is not drawn as a choice.

Lay the map out so the start and goal have more than one way between them, or the run has no choices. On a generated map coilbox picks the two ends to avoid that. On your map it uses your ends exactly, and does not warn you when the route has no choice.

### Giving a location a kind

A location takes `"warpath": { "kind": "shop" }`. The kind is one of `battle`, `elite`, `shop`, `event` or `reward`. A location with no kind gets one from the run's seed. The start and the goal cannot have a kind. A kind on a map with no `start` and `goal` is accepted and unused, so you can mark a map up in stages.

A `battle` on a location replaces the generated encounter's map, and the enemy count, AI, handicap, start positions and mod options where you give them. What you leave out keeps the generated value. `disabledUnits` applies too. A location with no `battle` gets a generated encounter chosen by its depth along the route. Conquest's difficulty tiers are not used in Warpath, because a run has no difficulty per location.

A location that is a shop, event or reward has no fight, so a `scenario` on it is not played.

A start or goal whose placed model fails to load gets its default marker.

## Giving a location a scenario

A location can play a scenario in place of a skirmish. Set `scenario` to the name of a `.json` file in the map folder. Export the file from the scenario builder, or use a bare scenario document.

- A location has a `scenario` or a `battle`, never both.
- The scenario must be for the same game as the map. Coilbox checks the export's game shortname against `game.shortname`, and the scenario's game against `game.pinnedName` when the map has one. A bare scenario document on a map with no `pinnedName` cannot be checked until it is played, and the launch refuses it then if the game differs.
- The scenario needs a game and a map set in the scenario builder.
- The player plays it once, when they first attack the location. After they win it, any later attack on the location is a skirmish on the scenario's map. A defeat leaves the scenario to try again.
- The player does not pick the scenario's difficulty. Coilbox works it out from what the player chose when they started, as described below, and the briefing shows it.
- In Warpath the scenario plays as you set it up. The run's unit limit and perks are not applied to it.
- Coilbox decides the result from the replay. When it cannot, the briefing asks the player whether they won.

### How hard a scenario location plays

This only matters for a scenario where something is set to appear only on some difficulties. A scenario with nothing like that plays the same whatever the level, and coilbox does not set one.

In Conquest the level comes from the threat level the player started at and the location's `difficulty`, which count equally. A higher threat level or a higher `difficulty` never makes it easier.

| Threat level | `difficulty` 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| 0 | Easy | Easy | Easy | Normal | Normal |
| 1 | Easy | Easy | Normal | Normal | Hard |
| 2 | Normal | Normal | Normal | Hard | Hard |
| 3 | Normal | Normal | Hard | Hard | Hard |

In Warpath the level comes from the run's difficulty and how far along the route the location is, which count equally. Coilbox measures how far along by the same tech tier the skirmishes around it use, from 1 at the start to 5 at the goal. Ascension adds to the run's difficulty, as it does for a skirmish, up to the top row.

| Run difficulty | Tier 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| 1 | Easy | Easy | Easy | Normal | Normal |
| 2 | Easy | Easy | Normal | Normal | Normal |
| 3 | Easy | Normal | Normal | Normal | Hard |
| 4 | Normal | Normal | Normal | Hard | Hard |
| 5 or more | Normal | Normal | Hard | Hard | Hard |

Defending a scenario location in Conquest is a skirmish, so the location's `difficulty` sets it as it does any other.

## Versions and challenge codes

A player can share a challenge code for a Conquest or Warpath on your map. The code names the map by its `id` and a fingerprint, and the other player needs their own copy of the same version. A player with no copy is told the map's title and its game. A player with another version is told so. Nothing starts in either case.

The fingerprint is 16 hex digits made from what changes how the map plays. When you change one of these things you make a new version.

- The game's `shortname`.
- Each faction's `id`, `aggression`, `aiKey` and `side`, whether the player may pick it, and the order of the factions.
- Each location's `id`, `owner`, `capital`, `difficulty`, `battle` and Warpath `kind`, and the order of the locations.
- The scenario a location plays, by its content.
- Which locations are joined and how: painted borders, crossings and roads.
- The blocked borders.
- The Warpath `start` and `goal`.

These do not change it.

- The map's `title` and `description`, and a location's `name` and `blurb`.
- A faction's `name` and `color`, and `playerFaction`.
- The picture, the heightmap, `heightScale`, `size` and the placed models.
- Where a marker sits, from `anchor` or `pos`.
- The colour a province is painted in, and how the images are compressed.
- A repaint that leaves every province touching the same neighbours.
- A scenario's file name, its own name, description and dates, and its dialogue clips.
- `game.pinnedName`, and a battle's `mapDownload`.

The order of factions and locations counts because the battle maps coilbox picks for locations with no `battle` are drawn in location order. Reordering gives a different battlefield for the same seed.

A scenario counts by its content. That includes the game build it was exported on, so exporting the scenario again after another change makes a new version of the map.

## Error messages

The reader reports problems in stages. Fix what it reports, then read again. In the messages below, words in capitals stand for a value from your map.

1. Problems with the shape of `map.json`: a file that is not JSON, a missing or wrong key, a shared colour or a shared id. These are reported alone, because nothing else can be trusted until they are fixed.
2. A province image or a map picture that is missing from the folder.
3. An image that cannot be opened. This covers the province image, the map picture and the heightmap.
4. Everything else, in one list: capitals, links, Warpath markings, scenarios, missing heightmap or model files, and the paint.

### Problems with map.json

| Message | What it means | What to do |
| --- | --- | --- |
| `map.json is not valid JSON: DETAIL` | The file is not JSON. DETAIL is the parser's own description. | Look for a missing comma, quote or bracket near the place DETAIL names. |
| `map.json must hold one JSON object.` | The file is JSON, but it is a list or a single value. | Wrap the manifest in `{` and `}`. |
| `map.json: KEY PROBLEM` | A key is missing or holds a value the reader does not accept. See [Key problems](#key-problems). | Fix the key that KEY names. |
| `map.json: "NAME" and "NAME" are both listed with the colour COLOUR. Each province needs its own colour.` | Two provinces list the same colour. | Repaint one province in a new colour and list that colour. |
| `map.json: "NAME" and "NAME" both have the id "ID". Give one of them its own "id".` | Two locations have the same id, set by hand or made from their names. | Add an `id` to one of them. |
| `map.json: "NAME" has a scenario and a battle. A location plays one or the other, so remove one of them.` | A location has both `scenario` and `battle`. | Remove one. |
| `The faction "NAME" has no capital. Set "capital": true on one location it owns.` | A faction owns no capital. | Set `"capital": true` on one location that faction owns. |
| `The faction "NAME" has N capitals: NAMES. Keep "capital": true on one of them.` | A faction owns more than one capital. | Remove `capital` from all but one. |
| `map.json: LIST[N] names "ID", which is not the id of any location.` | A crossing, blocked border or road names a location that does not exist. LIST is `crossings`, `blockedBorders` or `roads`. N counts from 0. | Check the spelling. The default id is the name in lower case with `-` between words. |
| `"NAME" and "NAME" have a blocked border and a crossing. Remove one of the two.` | The same pair is blocked and joined by a crossing. | Remove the pair from one list. |
| `"NAME" and "NAME" have a blocked border and a road. Remove one of the two.` | The same pair is blocked and joined by a road. | Remove the pair from one list. |
| `map.json: "NAME" has the Warpath kind "KIND", which Warpath does not know. Use one of: battle, elite, shop, event, reward.` | A location's `warpath.kind` is not one of the five. | Use one of the kinds the message lists. |
| `map.json: warpath.start names "ID", which is not the id of any location.` | The Warpath start is not a location. The same message exists for `warpath.goal`. | Check the spelling of the id. |
| `map.json: warpath has a start and no goal. Warpath needs both. Add warpath.goal, or remove warpath.start to offer the map in Conquest only.` | Only one end is given. The same message exists with start and goal swapped. | Give both, or remove `warpath`. |
| `map.json: the Warpath start and goal are both "NAME". They must be different locations.` | Both ends are one location. | Pick two locations. |
| `map.json: "NAME" is the Warpath END, so it cannot also have the kind "KIND". Remove the kind, or move the END.` | The start or goal has a `warpath.kind`. END is `start` or `goal`. | Remove the kind. |

### Key problems

Each of these follows `map.json:` and the key. A province or point location is named by its place in the list and its name, such as `provinces[2] ("Midvale").owner`. Places count from 0. A model entry is named the same way, by its place and its file or game name, such as `models[0] ("cairn.gltf").pos`.

| Key | Problem as written | What to do |
| --- | --- | --- |
| `formatVersion` | `must be 1.` | Set `"formatVersion": 1`. |
| `formatVersion` | `is N, which is newer than this coilbox reads (1). Update coilbox to use this map.` | Update coilbox. The map was written for a newer version. |
| `id`, `title`, `game.shortname`, a faction's `id` or `name`, a location's `name` | `must be text and cannot be empty.` | Add the key, in quotes, with a value. |
| `id` | `may only use letters, digits and -.` | Remove spaces and other characters from the map's id. |
| `description`, `playerFaction`, `game.pinnedName`, a faction's `aiKey` or `side`, a location's `id`, `owner` or `blurb`, a battle's `enemyAiKey`, `warpath.start`, `warpath.goal`, a location's `warpath.kind` | `must be text.` | Put the value in quotes. |
| `game` | `must be an object such as { "shortname": "BYAR" }.` | Write `game` as an object with a `shortname`. |
| `size` | `must be an object such as { "width": 2000, "height": 1500 }.` | Write `size` as an object with `width` and `height`. |
| `size.width`, `size.height` | `must be a number above 0.` | Give a number above 0, without quotes. |
| `files` | `must be an object naming the picture and provinces files.` | Write `files` as an object with `picture` and `provinces`. |
| `files.picture`, `files.provinces`, `files.heightmap` | `must be the name of a file inside the map folder.` | Give a file name or a path inside the folder, written with `/`. |
| `heightScale` | `must be a number above 0.` | Give a number above 0, or remove the key. |
| `background` | `must be a colour such as #ffffff.` | Write the colour as `#` and six hex digits. |
| `factions` | `must list at least one faction.` | Add a faction. |
| `factions` | `must have at least one faction the player can pick.` | Remove `"playable": false` from at least one faction. |
| An entry in `factions`, `provinces`, `locations` | `must be an object.` | Write the entry inside `{` and `}`. |
| A faction's or a province's `color` | `must be a colour such as #cc3333.` | Write the colour as `#` and six hex digits. |
| A faction's `id` | `cannot be "neutral", which means no owner.` | Pick another id. |
| A faction's `id` | `"ID" is used by two factions.` | Give each faction its own id. |
| A faction's `aggression` | `must be a number from 0 to 1.` | Give a number from 0 to 1. |
| A faction's `playable`, a location's `capital` | `must be true or false.` | Write `true` or `false` without quotes. |
| `playerFaction` | `"ID" is not the id of a faction the player can pick.` | Use the id of a faction that is not `"playable": false`. |
| `provinces` | `must be a list of provinces.` | Add `provinces` as a list, inside `[` and `]`. |
| `provinces` | `is empty, and the map needs at least one location.` | Add a province or a point location. |
| `locations` | `must be a list of point locations.` | Write `locations` as a list, or remove it. |
| A location's `id` | `may only use letters, digits, - and _.` | Remove spaces and other characters from the id. |
| A location's `id` | `is needed, because the name has no letters or digits to make one from.` | Add an `id` by hand. |
| A location's `owner` | `"ID" is not a faction id. Use one of: IDS.` | Use one of the ids the message lists. |
| A location's `capital` | `is true, so the location needs an owner.` | Set `owner` to a faction id. |
| A location's `difficulty` | `must be a whole number from 1 to 5.` | Give 1, 2, 3, 4 or 5. |
| A location's `scenario` | `must be the name of a .json scenario file inside the map folder.` | Give a file name that ends in `.json`, inside the folder. |
| A location's `warpath` | `must be an object such as { "kind": "shop" }.` | Write `warpath` as an object. |
| `warpath` | `must be an object such as { "start": "kent", "goal": "calais" }.` | Write `warpath` as an object with `start` and `goal`. |
| A province's `color` | `is COLOUR, the same as the background.` | Repaint the province in another colour, or change `background`. |
| A province's `anchor`, a point location's `pos`, a model's `pos` | `must be a position such as [120, 340].` | Write two numbers inside `[` and `]`. |
| A province's `anchor`, a point location's `pos`, a model's `pos` | `is [X, Y], which is outside the map (WIDTH by HEIGHT).` | Move the position inside the map. Positions are in map units, not pixels. |
| A location's `battle` | `must be an object such as { "mapName": "Comet Catcher Redux" }.` | Write `battle` as an object, or remove it. |
| A battle's `mapName` | `must be the name of a map. Leave the whole battle out to have one picked.` | Give a map name, or remove `battle`. |
| A battle's `enemyAiCount` | `must be a whole number from 1 to 8.` | Give a whole number from 1 to 8. |
| A battle's `startPosType` | `must be a whole number, 0 or above.` | Give a whole number, 0 or above. |
| A battle's `handicap` | `must be a whole number from 0 to 300.` | Give a whole number from 0 to 300. |
| A battle's `mapDownload` | `must have a springName or a searchUrl.` | Add one of the two, as text. |
| A battle's `modOptionValues` | `must map option names to text values.` | Put every value in quotes. |
| A battle's `disabledUnits` | `must be a list of unit names.` | Write a list of unit names in quotes. |
| `crossings`, `blockedBorders`, `roads` | `must be a list of pairs of location ids.` | Write the key as a list of pairs. |
| An entry in `crossings`, `blockedBorders` or `roads` | `must be a pair of location ids such as ["kent", "calais"].` | Write two ids in quotes inside `[` and `]`. |
| An entry in `crossings`, `blockedBorders` or `roads` | `joins "NAME" to itself.` | Name two different locations. |
| `models` | `must be a list of models.` | Write `models` as a list. |
| An entry in `models` | `must be an object such as { "model": { "file": "tower.glb" }, "pos": [120, 340] }.` | Write the entry as an object. |
| A model's `model` | `must name one model: { "file": "tower.glb" } for a file in the map folder, or { "game": "armcom" } for a model the game has.` | Give `file` or `game`, not both and not neither. |
| A model's `model.game` | `must be text and cannot be empty.` | Give a model name in quotes. |
| A model's `model.file` | `must be the name of a file inside the map folder.` | Give a path inside the folder, written with `/`. |
| A model's `model.file` | `is "FILE", which is not a glTF model. The name must end in .gltf or .glb.` | Use a `.gltf` or `.glb` file. |
| A model's `height`, `rotation` | `must be a number.` | Give a number without quotes. |
| A model's `scale` | `must be a number above 0.` | Give a number above 0. |
| An entry in `models` | `is not a model the map can place.` | Check each key of the entry. |

### Problems with the files, the paint and the Warpath route

| Message | What it means | What to do |
| --- | --- | --- |
| `map.json names the province image "FILE", but the folder has no file with that name.` | The file in `files.provinces` is not in the folder. | Check the file name, including upper and lower case. |
| `map.json names the picture "FILE", but the folder has no file with that name.` | The file in `files.picture` is not in the folder. | Check the file name. |
| `map.json names the heightmap "FILE", but the folder has no file with that name.` | The file in `files.heightmap` is not in the folder. | Check the file name, or remove `heightmap` from `files`. |
| `"FILE" could not be opened as an image. Save it again as a PNG.` | The province image, the map picture or the heightmap is not an image coilbox can open. | Save it again as a PNG. |
| `The province image "FILE" is W by H pixels and the map picture "FILE" is W by H. They must be the same size.` | The two images differ in size. | Resize one to match the other. Turn smoothing off when you resize the province image. |
| `The province image has the colour COLOUR at pixel X, Y (counted from the top left), but map.json lists no province with that colour. Add a province for it, or repaint the area.` | A patch of a colour that no province lists. The pixel is inside the patch. Each separate patch is reported once. | Go to that pixel in your image editor. Repaint the patch, or add a province with that colour. |
| `The province "NAME" (COLOUR) is listed in map.json, but its colour is not painted anywhere on the province image. Check the colour matches exactly.` | No pixel has that province's colour. | Pick the colour from the image and copy its value into `map.json`. |
| `map.json blocks the border between "NAME" (COLOUR) and "NAME" (COLOUR), but they do not touch on the province image.` | A blocked border is listed between two provinces that are not neighbours. A point location is shown by its name alone. | Remove the pair, or repaint so the two provinces share an edge. |
| `The province "NAME" (COLOUR) cannot be reached from the rest of the map. Nothing touches it. Add a crossing or a road in map.json, or paint it so it touches a neighbour.` | The province has no link to any other location. | Add a crossing or a road, or repaint it. |
| `The province "NAME" (COLOUR) cannot be reached from the rest of the map. It is joined only to NAMES. Add a crossing or a road in map.json, or paint it so it touches a neighbour.` | The province is in a small group that is cut off from the main body of the map. | Add a crossing or a road from the group to the main body. |
| `The location "NAME" cannot be reached from the rest of the map.` followed by `No road or crossing joins it.` or `It is joined only to NAMES.`, then `Add a road or a crossing to it in map.json.` | The same, for a point location. | Add a road or a crossing to it. A point location cannot be painted. |
| `A Warpath run cannot get from the start NAME to the goal NAME. Join them with a crossing or a road in map.json, or paint the land between them so it touches.` | The goal cannot be reached from the start. | Join the two with links, or remove `warpath`. |
| `map.json: "NAME" names the scenario file "FILE", but the folder has no file with that name.` | The scenario file is not in the folder. | Check the file name. |
| `The scenario file "FILE" for "NAME" cannot be used. WHY` | The file is there but is not a scenario coilbox can play. WHY is one of the two sentences below, or the scenario importer's own reason. | Export the scenario again from the scenario builder. |
| WHY: `The file could not be read.` | The file is in the folder but its text could not be fetched. | Check the file is a valid text file. |
| WHY: `It has no game and map yet. Set it up in the scenario builder and export it again.` | The scenario has no game or no map. | Set both in the scenario builder and export again. |
| `The scenario file "FILE" for "NAME" is for the game "GAME", and this map is for "GAME". A location can only play a scenario made for the map's game.` | The scenario was made for another game. | Export a scenario for the map's game, or change the map's `game`. |
| `map.json: models[N] names the model file "FILE", but the folder has no file with that name.` | A `file` model is not in the folder. | Check the file name. |
| `map.json: models[N] names the model "FILE", which needs the file "PATH", but the folder has no file with that name.` | A `.gltf` names a `.bin` or texture that is not in the folder. | Add the file, or save the model with its data inside. |
| `map.json: models[N] names the model "FILE", which points at "PATH" outside the map folder. Put the file in the folder and point at it there.` | A `.gltf` names a file outside the folder. | Move the file into the folder and edit the path in the `.gltf`. |

### Problems with an installed map

These come from the Conquest page, the import and the game archive reader.

| Message | What it means | What to do |
| --- | --- | --- |
| `map.json: the id "ID" does not match the folder "FOLDER" the map is stored in.` | An imported map's folder was renamed or copied in by hand. Coilbox stores an imported map in a folder named after its id. | Import the map from a zip instead. |
| `No hand-made map with the id "ID" is installed, and no installed game carries one. A game update may have removed it.` | Coilbox was asked for a map it does not have. | Bundle or import the map, or update the game. |
| `The game "GAME" carries a map with the id "ID", and a map a game carries cannot be replaced. Change the id in map.json and import it again.` | You imported a zip whose id a game archive already uses. | Give your map another `id`. |
| `A map with the id "ID" ships with this copy of coilbox and cannot be replaced.` | You imported a zip whose id a bundled map uses. | Give your map another `id`. |
| `The map was installed as "ID" but could not be read back, and taking it out again failed. Remove it from the Conquest page. DETAIL` | The import copied the map and could not read it. | Remove the map from the Conquest page, then import it again. |
| `map.json: the game shortname "NAME" is not "NAME", the shortname of the game that carries the map.` | A map in a game archive names another game. | Set `game.shortname` to the game's own shortname. |
| `"FILE" is in the game archive, but WHY` | The reader could not read a file from the game archive. See [Inside a game archive](#inside-a-game-archive). | Follow WHY. |
| `coilbox/maps/index.json is not valid JSON, so its settings are not used.` | The game archive's settings file is not JSON. | Fix the JSON. |
| `coilbox/maps/index.json must hold an object such as { "onlyOwnMaps": true }.` | The settings file is a list or a single value. | Wrap it in `{` and `}`. |
| `coilbox/maps/index.json: onlyOwnMaps must be true or false.` | `onlyOwnMaps` holds something else. | Write `true` or `false` without quotes. |

### Problems with a zip

The import refuses a zip with one of these sentences. See [As a zip](#as-a-zip) for the rules behind them.

| Message | What to do |
| --- | --- |
| `This is not a zip file: DETAIL` or `Could not open the zip file: DETAIL` or `Could not read the zip file: DETAIL` | Zip the folder again. |
| `The zip holds N entries, and a map may hold N at most.` | Remove files the map does not use. |
| `The zip holds "PATH", which is a link to another file. A map may hold only files.` | Replace the link with the file. |
| `The zip holds "PATH", which is an absolute path.` | Zip the folder from inside its parent, so paths are relative. |
| `The zip holds "PATH", which has a character a file name cannot use.` | Rename the file without backslashes, colons or control characters. |
| `The zip holds "PATH", which points outside the map folder.` | Remove the `..` step from the path. |
| `The zip has no map.json at its top level or inside a single folder.` | Put `map.json` at the top of the zip, or keep every file inside one folder. |
| `The zip unpacks to more than N MB, which is larger than a map may be.` | Shrink the images, or leave out files the map does not use. |
| `Could not unpack "PATH": DETAIL` | Two entries may share a name. Rename one and zip again. |
| `map.json needs an "id" made of letters, digits and -.` | Fix the `id`. |

## Ship a map

There are three ways to put a map in front of players. One map folder works in all three.

### Bundled with a distribution

Put the map folder inside `.coilbox/galaxies/` beside the app. See [Distribution profiles](distribution-profile.md#bundling-a-hand-made-map).

```
<YourGameFolder>/
  .coilbox/
    profile.json
    galaxies/
      two-shores/
        map.json
        picture.png
        provinces.png
        heightmap.png
```

- Any folder directly inside `galaxies/` that holds a `map.json` is a map.
- The Conquest page lists it with a Bundled label. In Warpath it is offered when it has a `warpath` start and goal.
- A bundled map is read-only. A player cannot replace it or remove it.
- A player cannot import a zip whose map has the same id as a bundled map.

### As a zip

Zip the map folder. `map.json` must be at the top level of the zip, or every file must be inside one folder that holds `map.json`.

A player imports it with Import map on the Conquest page. Coilbox unpacks the zip to a temporary folder and runs the reader on it. It installs the map only when the reader accepts it. A refused zip leaves nothing behind and does not change a map that is already installed. If a map with the same id is installed, the player is asked whether to replace it. A conquest in progress on it is kept.

The import keeps files of these types: `.json`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gltf`, `.glb` and `.bin`.

It leaves these out and carries on. The player is told how many files were left out.

- any other file type
- any file or folder whose name starts with `.`
- anything inside a `__MACOSX` folder

It refuses the whole zip when:

- it holds more than 1024 entries, counting the ones left out (`MAX_ENTRIES`)
- it unpacks to more than 256 MB (`MAX_UNPACKED_BYTES`)
- an entry is a link to another file
- an entry's path is absolute, contains `..`, or contains a backslash, a colon or a control character
- two entries have the same name
- it has no `map.json` at the top level or inside a single folder
- the `id` in `map.json` is not made of letters, digits and `-`
- a bundled map or a map a game carries has the same id

The two limits are the values the code enforces today. The code comments call them a reasoned ceiling and a guess, and issue #3562 covers revisiting them once authors have made maps. The 256 MB limit counts the bytes written, not the sizes the zip declares.

An imported map is stored in coilbox's data folder, in `conquest/maps/` under a folder named after the map's id.

### Inside a game archive

A game that ships with the map needs no coilbox distribution. Put each map folder in the game archive under `coilbox/maps/`.

```
coilbox/
  maps/
    index.json
    two-shores/
      map.json
      picture.png
      provinces.png
```

- Each folder directly inside `coilbox/maps/` that holds a `map.json` is a map. The path is the constant `ARCHIVE_MAPS_DIR` in `src/conquest/handmade/archive.ts`. It is not `maps/`, because the engine looks for `.smf` maps there.
- A loose `.sdd` folder and a packed `.sdz` or `.sd7` read the same way.
- The map's `game.shortname` must be the shortname of the game that carries it.
- The map is listed for that game, read-only, with a From the game label. It is offered in Warpath when it has a `warpath` start and goal.
- Coilbox reads the list again when it rescans the games or finishes a download. A conquest on a carried map records the game's name. If a game update removes the map, the save says the game no longer carries it.
- On an id clash the order is the bundled map, then the map a game carries, then an imported map. Between two installed versions of a game, the newer version's map is shown.

A map in a game archive can use everything a folder on disk can, models included. A `.gltf` finds its `.bin` and texture files beside it in the archive, as it does on disk.

One file can be up to 256 MB, the same as the most a map zip may unpack to. This is the constant `RAW_CAP` in `crates/coilbox-unitsync-worker/src/archive.rs`. A larger file is refused with an error naming the file.

#### Hide the generated styles

A game that wants only its own maps can say so in `coilbox/maps/index.json`.

```json
{ "onlyOwnMaps": true }
```

With the flag set, the Generate a map drawer does not offer that game, and the Warpath setup offers only its maps. If the game carries no map that can be listed, or in Warpath no map with a start and a goal, the generated styles stay, so a broken archive never leaves a player with nothing.

A distribution profile has the same switch, `onlyOwnMaps` in `profile.json`. It applies to every game the distribution offers, so a distribution built for one game needs nothing more. Either the profile or the game archive is enough to hide the styles. The same fallback applies. A game with no hand-made map to offer, whether bundled, from its archive or imported, keeps the generated styles. See [`onlyOwnMaps`](distribution-profile.md#onlyownmaps-boolean).
