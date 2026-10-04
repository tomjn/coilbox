# Hand-made maps

A hand-made map is a folder that holds a text file and two or three images. You paint the provinces in an image editor and describe them in `map.json`. Coilbox reads the folder into a Conquest map of land, with provinces, cities, borders and roads. There is no map editor.

This guide takes you from an empty folder to a folder that the reader accepts.

## What works today

This feature is part way built. Read this list before you start, so you know what to expect.

- The reader is in coilbox. It checks `map.json` and the province image and gives the error messages listed in [Error messages](#error-messages).
- Coilbox finds map folders bundled with a distribution, and it can unpack a map from a zip.
- No screen in coilbox opens a hand-made map yet. The Conquest page entry and the import button are not available yet, so today you cannot play a hand-made map or see the reader's messages in the app.
- Maps inside a game archive are not available yet.
- Three parts of the manifest are reserved and ignored. See [Not yet](#not-yet).

## Start from the sample

The sample map is in the coilbox repository at [`docs/examples/handmade-map`](https://github.com/tomjn/coilbox/tree/main/docs/examples/handmade-map). Copy the folder and change it. It holds four files.

| File | What it is |
| --- | --- |
| `map.json` | The manifest. It names the other files and lists the factions, provinces and links. |
| `picture.png` | The map picture the player sees. |
| `provinces.png` | The province image. Each province is one flat colour. |
| `heightmap.png` | A greyscale image that raises the land. Optional. |

The manifest must be called `map.json`. The images can have any name, because the manifest names them in `files`.

The sample is small. Its three images are 160 by 96 pixels and its `size` is 1600 by 960, so one pixel is 10 map units. It has two land masses with sea between them, nine provinces, two factions and one city.

The sample's images are drawn by a script, `scripts/build-sample-handmade-map.mjs`, so you can read how each one is made.

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

Brushes and resizing blend colours along an edge. The blended pixels match no province. The reader settles them like this.

- A pixel is painted when it is at least half opaque, which is an alpha of 128 or more out of 255. A fainter pixel is unpainted.
- A painted pixel whose colour is not listed, and is not the background colour, is unsettled.
- The reader makes 2 passes. In each pass an unsettled pixel that sits beside a settled pixel takes the settled neighbour whose colour is nearest to its own. Neighbours are the pixels above, below, left and right.
- With a `background` colour, the unpainted area competes like a province. Without one, an unsettled pixel becomes unpainted only when no province is beside it.

Each pass works in from both sides. So a blended seam up to 4 pixels wide disappears. A patch of unlisted colour 5 pixels across keeps its middle pixel, and the reader reports it as a colour that is painted but not listed.

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

The reader traces the outer edge of each piece and straightens it. The traced outline stays within 1 pixel of the painted edge, so a sloped edge painted as a staircase becomes a straight line. A hole inside a piece is not traced.

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
    { "color": "#4f9da6", "name": "Eastcliff", "difficulty": 2 },
    { "color": "#8a6fc2", "name": "Southreach" },
    { "color": "#b55f9a", "name": "Ironcoast", "difficulty": 3 },
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
  "roads": [["stonebridge", "midvale"], ["stonebridge", "southreach"]]
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
| `warpath` | object | No | Reserved. Ignored today. |
| `models` | list | No | Reserved. Ignored today. |

The map needs at least one location. `provinces` must be present, and `provinces` and `locations` cannot both be empty.

### Game

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `shortname` | text | Yes | The `shortname` in the game's modinfo. |
| `pinnedName` | text | No | The exact archive name of one version of the game, for a map that must use that version. |

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
| `id` | text | No | The id that crossings, blocked borders, roads and saved games use. Letters, digits, `-` and `_`. See below for the default. |
| `owner` | text | No | A faction id, or `neutral`. Defaults to `neutral`. |
| `capital` | true or false | No | True for a faction's capital. A capital needs an owner. |
| `difficulty` | whole number | No | From 1 to 5. How hard the battle is. Defaults to 1. |
| `battle` | object | No | The battle fought here. See [Battle](#battle). |
| `blurb` | text | No | A sentence or two about the location. |
| `warpath` | object | No | Reserved. Ignored today. |
| `scenario` | text | No | Reserved. Ignored today. |

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

- Set `id` by hand before you rename a location, so saved games keep their place.
- No two locations can end up with the same id. Provinces and point locations share one set of ids.

Each faction needs exactly one capital. That includes a faction the player cannot pick. A capital can be a province or a point location.

### Battle

Leave `battle` out when you do not need a particular map. The reader then marks the location's battle as blank, for coilbox to fill by the location's difficulty. The step that fills it is not available yet.

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

The reader skips this check while a colour is painted but not listed, a province is listed but not painted, or a pair names an unknown location. Each of those makes provinces look cut off when they are not. So fixing one of them can bring out a "cannot be reached" message on the next read.

## The heightmap

The heightmap is optional. Without one the map is flat.

- Black is ground level, height 0.
- White is `heightScale` map units high.
- A grey in between is in proportion. A pixel's value from 0 to 1 is multiplied by `heightScale`.
- Without `heightScale`, white is 0.05 of the map's longer side. A map 1000 units wide gets peaks 50 units tall.

The sample sets `heightScale` to 120 on a map 1600 units wide.

Coilbox reads the red channel of the image, at 256 levels. A 16 bit image is read at 256 levels too. Save a greyscale image so that red, green and blue agree.

The heightmap is stretched over the whole map. The first and last pixels of each row and column sit on the map's edges, and heights between pixels are blended. The reader does not check the heightmap's size, so it does not have to match the picture.

The terrain is drawn with at most 256 steps along the map's longer side. A heightmap with more than 257 pixels on that side is sampled at those steps, so the extra pixels add little.

If `map.json` names a heightmap that is not in the folder, the reader reports it. A heightmap that is in the folder but cannot be opened as an image gives no message, and the map is drawn flat.

## Error messages

The reader reports problems in stages. Fix what it reports, then read again.

1. Problems with the shape of `map.json`: a file that is not JSON, a missing or wrong key, a shared colour or a shared id. These are reported alone, because nothing else can be trusted until they are fixed.
2. A province image or a map picture that is missing from the folder.
3. A province image or a map picture that cannot be opened.
4. Everything else, in one list: capitals, links, a missing heightmap and the paint.

In the messages below, words in capitals stand for a value from your map.

### Problems with map.json

| Message | What it means | What to do |
| --- | --- | --- |
| `map.json is not valid JSON: DETAIL` | The file is not JSON. DETAIL is the parser's own description. | Look for a missing comma, quote or bracket near the place DETAIL names. |
| `map.json must hold one JSON object.` | The file is JSON, but it is a list or a single value. | Wrap the manifest in `{` and `}`. |
| `map.json: KEY PROBLEM` | A key is missing or holds a value the reader does not accept. See the next table. | Fix the key that KEY names. |
| `map.json: "NAME" and "NAME" are both listed with the colour COLOUR. Each province needs its own colour.` | Two provinces list the same colour. | Repaint one province in a new colour and list that colour. |
| `map.json: "NAME" and "NAME" both have the id "ID". Give one of them its own "id".` | Two locations have the same id, set by hand or made from their names. | Add an `id` to one of them. |
| `The faction "NAME" has no capital. Set "capital": true on one location it owns.` | A faction owns no capital. | Set `"capital": true` on one location that faction owns. |
| `The faction "NAME" has N capitals: NAMES. Keep "capital": true on one of them.` | A faction owns more than one capital. | Remove `capital` from all but one. |
| `map.json: LIST[N] names "ID", which is not the id of any location.` | A crossing, blocked border or road names a location that does not exist. LIST is `crossings`, `blockedBorders` or `roads`. N counts from 0. | Check the spelling. The default id is the name in lower case with `-` between words. |
| `"NAME" and "NAME" have a blocked border and a crossing. Remove one of the two.` | The same pair is blocked and joined by a crossing. | Remove the pair from one list. |
| `"NAME" and "NAME" have a blocked border and a road. Remove one of the two.` | The same pair is blocked and joined by a road. | Remove the pair from one list. |

### Key problems

Each of these follows `map.json:` and the key. A province or point location is named by its place in the list and its name, such as `provinces[2] ("Midvale").owner`. Places count from 0.

| Key | Problem as written | What to do |
| --- | --- | --- |
| `formatVersion` | `must be 1.` | Set `"formatVersion": 1`. |
| `formatVersion` | `is N, which is newer than this coilbox reads (1). Update coilbox to use this map.` | Update coilbox. The map was written for a newer version. |
| `id`, `title`, `game.shortname`, a faction's `id` or `name`, a location's `name` | `must be text and cannot be empty.` | Add the key, in quotes, with a value. |
| `id` | `may only use letters, digits and -.` | Remove spaces and other characters from the map's id. |
| `description`, `playerFaction`, `game.pinnedName`, a faction's `aiKey` or `side`, a location's `id`, `owner` or `blurb`, a battle's `enemyAiKey` | `must be text.` | Put the value in quotes. |
| `game` | `must be an object such as { "shortname": "BYAR" }.` | Write `game` as an object with a `shortname`. |
| `size` | `must be an object such as { "width": 2000, "height": 1500 }.` | Write `size` as an object with `width` and `height`. |
| `size.width`, `size.height` | `must be a number above 0.` | Give a number above 0, without quotes. |
| `files` | `must be an object naming the picture and provinces files.` | Write `files` as an object with `picture` and `provinces`. |
| `files.picture`, `files.provinces`, `files.heightmap` | `must be the name of a file inside the map folder.` | Give a file name or a path inside the folder, written with `/`. |
| `heightScale` | `must be a number above 0.` | Give a number above 0, or remove the key. |
| `background` | `must be a colour such as #ffffff.` | Write the colour as `#` and six hex digits. |
| `factions` | `must list at least one faction.` | Add a faction. |
| `factions` | `must have at least one faction the player can pick.` | Remove `"playable": false` from at least one faction. |
| An entry in `factions`, `provinces` or `locations` | `must be an object.` | Write the entry inside `{` and `}`. |
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
| A province's `color` | `is COLOUR, the same as the background.` | Repaint the province in another colour, or change `background`. |
| A province's `anchor`, a point location's `pos` | `must be a position such as [120, 340].` | Write two numbers inside `[` and `]`. |
| A province's `anchor`, a point location's `pos` | `is [X, Y], which is outside the map (WIDTH by HEIGHT).` | Move the position inside the map. Positions are in map units, not pixels. |
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

### Problems with the files and the paint

| Message | What it means | What to do |
| --- | --- | --- |
| `map.json names the province image "FILE", but the folder has no file with that name.` | The file in `files.provinces` is not in the folder. | Check the file name, including upper and lower case. |
| `map.json names the picture "FILE", but the folder has no file with that name.` | The file in `files.picture` is not in the folder. | Check the file name. |
| `map.json names the heightmap "FILE", but the folder has no file with that name.` | The file in `files.heightmap` is not in the folder. | Check the file name, or remove `heightmap` from `files`. |
| `"FILE" could not be opened as an image. Save it again as a PNG.` | The province image or the map picture is not an image coilbox can open. | Save it again as a PNG. |
| `The province image "FILE" is W by H pixels and the map picture "FILE" is W by H. They must be the same size.` | The two images differ in size. | Resize one to match the other. Turn smoothing off when you resize the province image. |
| `The province image has the colour COLOUR at pixel X, Y (counted from the top left), but map.json lists no province with that colour. Add a province for it, or repaint the area.` | A patch of a colour that no province lists. The pixel is inside the patch. Each separate patch is reported once. | Go to that pixel in your image editor. Repaint the patch, or add a province with that colour. |
| `The province "NAME" (COLOUR) is listed in map.json, but its colour is not painted anywhere on the province image. Check the colour matches exactly.` | No pixel has that province's colour. | Pick the colour from the image and copy its value into `map.json`. |
| `map.json blocks the border between "NAME" (COLOUR) and "NAME" (COLOUR), but they do not touch on the province image.` | A blocked border is listed between two provinces that are not neighbours. A point location is shown by its name alone. | Remove the pair, or repaint so the two provinces share an edge. |
| `The province "NAME" (COLOUR) cannot be reached from the rest of the map. Nothing touches it. Add a crossing or a road in map.json, or paint it so it touches a neighbour.` | The province has no link to any other location. | Add a crossing or a road, or repaint it. |
| `The province "NAME" (COLOUR) cannot be reached from the rest of the map. It is joined only to NAMES. Add a crossing or a road in map.json, or paint it so it touches a neighbour.` | The province is in a small group that is cut off from the main body of the map. | Add a crossing or a road from the group to the main body. |
| `The location "NAME" cannot be reached from the rest of the map.` followed by the same two endings | The same, for a point location. | Add a road or a crossing to it. A point location cannot be painted. |

### Problems with an installed map

| Message | What it means | What to do |
| --- | --- | --- |
| `map.json: the id "ID" does not match the folder "FOLDER" the map is stored in.` | An imported map's folder was renamed or copied in by hand. Coilbox stores an imported map in a folder named after its id. | Import the map from a zip instead. |
| `No hand-made map with the id "ID" is installed.` | Coilbox was asked for a map it does not have. | Bundle or import the map. |

## Ship a map

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
- A bundled map is read-only. A player cannot replace it or remove it.
- A player cannot import a zip whose map has the same id as a bundled map.

### As a zip

Zip the map folder. `map.json` must be at the top level of the zip, or every file must be inside one folder that holds `map.json`.

The import button is not available yet. The rules below are the ones coilbox applies when it unpacks a zip.

Coilbox keeps files of these types: `.json`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gltf`, `.glb` and `.bin`.

It leaves these out and carries on:

- any other file type
- any file or folder whose name starts with `.`
- anything inside a `__MACOSX` folder

It refuses the whole zip when:

- it holds more than 1024 entries, counting the ones left out
- it unpacks to more than 256 MB
- an entry is a link to another file
- an entry's path is absolute, contains `..`, or contains a backslash, a colon or a control character
- two entries have the same name
- it has no `map.json` at the top level or inside a single folder
- the `id` in `map.json` is not made of letters, digits and `-`
- a bundled map has the same id

Coilbox unpacks the zip to a temporary folder and runs the reader on it. It installs the map only when the reader accepts it. A refused zip leaves nothing behind and does not change a map that is already installed.

An imported map is stored in coilbox's data folder, in `conquest/maps/` under a folder named after the map's id.

### Inside a game archive

Not available yet. A game archive cannot carry a hand-made map today, and a game cannot yet hide the generated map styles.

## Not yet

The manifest reserves these keys. The reader accepts them and ignores them, whatever they hold. Do not expect them to do anything yet.

| Key | Where | Reserved for |
| --- | --- | --- |
| `warpath` | Top level | The ids of the Warpath start and goal, as `start` and `goal`. |
| `warpath` | A province or point location | The kind of Warpath location, as `kind`: battle, elite, shop, event or reward. |
| `scenario` | A province or point location | The name of a scenario file in the folder, played in place of a skirmish. |
| `models` | Top level | Models placed on the map, by game model name or glTF file. |

These parts of the feature are also not available yet.

- Opening a hand-made map from the Conquest page, and the import button.
- Filling a blank battle by difficulty.
- Playing Warpath on a hand-made map.
- Maps inside a game archive.
