# Conquest planets and biome data

Date: 6 October 2026

## Why

Every generated land map is the same world: blue sea, green land, the odd tan patch and a mountain. Players should be able to pick a planet, in the manner of the OTA campaign's worlds, and get land, sea and biomes that belong to it.

This is the first of three pieces. It gives the generator a planet and makes the biome data that the other two need.

1. Planets, biome data, sea kinds and the drawer picker. This spec.
2. Biome detail textures and the normal map. The normal map is 512 texels across the whole sheet, from 8 bit heights, and every biome except forest draws from one noise function.
3. Settlements. A modern base style in place of the medieval one, sealed outposts on hostile planets, matching roads, and more spread in town size.

## What is wrong with the code today

A biome is not stored anywhere. `terrainGen.ts` paints eight fixed land colours and two sea colours into the picture. The terrain shader (`galaxy3d/terrainShader.ts`) and the farm-field check (`galaxy3d/towns.ts`) each hold their own copy of that palette and work the biome out again by matching the pixel's colour.

That has two faults. A second palette breaks the matching. And a blended colour, such as a slope between grass and rock, sits between the reference colours and gets a weak, mixed answer.

## Decisions already made

- Old saves repaint with the update. The feature has just shipped and has little use, and players expect an update to improve their maps.
- The land mask and the heightmap of an existing Temperate map do not change, so locations, roads and crossings stay where they are.
- The picker covers the two land styles, Territories and Cities. The galaxy style is untouched.
- Hand-made maps are untouched. They have a picture and no biome data, and the shader's detail is already off for them.

## Approach

The generator writes biome weights, and the picture is mixed from them.

Each land pixel gets a share for up to eight biome slots. The shares are stored as two RGBA images at the terrain's own size, one byte a slot. The picture's colour is the planet's palette weighted by those shares, so the weights and the picture cannot disagree. Sea pixels carry no shares.

Today's `biomeColour` is a chain of `mix` calls. Each `mix(c, X, t)` is the same as scaling every share by `1 - t` and adding `t` to the share of `X`, so the chain converts to weights with no change to the colour it produces. Temperate's eight colours (beach, dry, grass, forest, tundra, rock, scree, snow) fill the eight slots.

The shader and the farm-field check read the weights. The palette lives in one place.

Two alternatives were rejected:

- Pass the palette to the shader and keep matching by colour. It is the smallest change, but blended slopes still fall between biomes.
- Store one biome number a pixel. A number cannot be filtered, so every biome edge would be a hard stepped line.

## Planets

A new `src/conquest/planets.ts` holds one record per planet:

- an id and a label
- up to eight biome slots, each with a name, a colour and whether fields grow there
- a rule that turns height, moisture and cold into slot weights
- the climate's bias, such as colder for Ice and drier for Desert
- the sea: its two ramp colours, its look, and whether it can be crossed and how
- an optional step that reshapes the heightmap after the land mask is fixed
- the swatch colours the picker shows

Colours are chosen on screen during the build. The spec fixes what each planet has, not its RGB values.

| Planet | Ground | Sea | Crossing |
|---|---|---|---|
| Temperate | grass, forest, desert, tundra, rock, scree, snow, beach | water | shipping lane |
| Desert | dunes, rock flats, mesa, scrub, salt pan | scarce water | shipping lane |
| Ice | snowfield, bare ice, tundra, rock | ice sheet | causeway |
| Red | red dust, dark basalt, pale dunes, rock | dry basin | track |
| Moon | regolith, bright highland, rock | dark maria | track |
| Volcanic | dark basalt, brown rock, ash, cooled flows | lava | none |
| Acid | dull yellow and brown ground, brown forest | green acid | none |

Notes on single planets:

- Temperate keeps its slots and its rule. Its desert is still drawn poorly after this piece, because what makes it read as faded grass is the missing pattern, which is piece 2.
- Moon stamps craters into the heightmap. The step runs after the land mask is fixed and never lowers land to sea level, so the mask and the locations do not move.
- Acid follows the acidic quarry look: green sea, desaturated ground, brown forest. No red.
- A cloud planet is left out of the first set. The sea's look is data, so it can be added later.

### Seas that cannot be crossed

Volcanic and Acid have a sea no route crosses. For those planets:

- the generator is asked for one land mass (`maxMasses: 1`), so no crossing is needed
- the drawer offers four shapes: continent, coast, inland sea and landlocked
- a stored or shared shape outside those four resolves to continent

`resolveLandLayout` takes the planet so that "random" picks only from the shapes the planet allows.

### Seas that are not liquid

The terrain shader draws ripples, a sun glint and foam on any sea. It gets one value for the sea's look. Foam and the glint are drawn for water and acid only. Lava glow and ice texture are piece 2.

A crossing draws as today's dotted shipping lane on liquid. On an ice sheet, a dry basin or maria it draws as a solid causeway or track. `galaxy3d/crossingLine.ts` gains that pattern. The states a crossing shows (owned, attackable, Warpath step) are unchanged.

## Data and compatibility

- `generated.planet` is stored on the map document as a planet id or `random`. Absent reads as Temperate. `model.ts` validates it the way it validates `layout`.
- `GenerateOptions` gains `planet`.
- "Surprise me" picks from the seed through a random stream of its own, derived from the seed, so it cannot disturb the land.
- Share codes carry the planet with no version bump, the way land layouts were added in `challenge.ts`. An older coilbox ignores it and builds the Temperate version of the same seed. For Volcanic and Acid that can be a different land, since the older build does not hold to one land mass.
- The generator keeps its arithmetic rules: integers, add, subtract, multiply, divide and `Math.sqrt` only.
- `GeneratedTerrain` gains the two weight images. `generateTerrainWithMargin` and `extendTerrain` carry them past the map's edge as they carry the picture.

## Drawer

A "Planet" dropdown sits above "Shape" in the generation drawer for the two land styles. Each option has a round swatch in the planet's ground and sea colours. "Surprise me" comes first and is the default.

Choosing Volcanic or Acid narrows "Shape". A shape that is no longer offered falls back through `offeredOr`, as the form already does when the style changes.

The setup summary and the reroll path read the planet from the document, like the other generation settings.

## What this piece shows on screen

- every planet with its own ground and sea colours
- foam and sun glint only on liquid seas
- crossings as a lane, a causeway or a track
- craters on Moon

Until pieces 2 and 3 land, a Volcanic map has the right colours with today's noise and today's towns.

## Tests

- `terrainGolden.test.ts`: Temperate's land mask and heightmap hashes stay as they are. The picture hash changes once, and the weight images get hashes.
- A hash of every array for each planet.
- On every land pixel the weights sum to 255, and the picture equals the palette mixed by the weights.
- Volcanic and Acid give one land mass for every shape they offer.
- Moon's land mask equals the mask of the same seed without craters.
- "Surprise me" gives the same planet for the same seed, and the land of a seed does not depend on how the planet was picked.
- Round trips for the saved document and the share code, including a code with no planet.
- A drawer test for the planet dropdown and the narrowed shapes.
- The farm-field check reads the weights: fields on a farmable slot, none elsewhere.

## Out of scope

- biome patterns, lava glow, ice texture and the normal map (piece 2)
- settlement styles, road styles and town sizes (piece 3)
- a cloud planet
- planets for the galaxy style or for hand-made maps
- a style or era picker
