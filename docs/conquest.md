# Galactic Conquest

**Galactic Conquest** is a single-player campaign across a map of territory you take one battle at a time. The map can be a galaxy of star systems, a flat theatre chart, cities joined by roads, or provinces on land masses. This page says "system" for one location on the map, which is a city on a Cities map and a province on a Territories map. You start holding a capital and a little territory; you win skirmishes to capture adjacent systems, defend against enemy incursions, and take every enemy capital to conquer the map. Each system is a full skirmish (map, game, AI opponents scaled to that system's difficulty); playing one launches it like any other skirmish, and on exit Coilbox works out win/loss and advances the map.

Conquests live under **Conquest** in the sidebar. You can generate one for any installed game, or play a map a distribution ships (see [Bundling a galaxy](#bundling-a-galaxy)).

![The strategic map: named star systems joined by lanes over a 3D starfield, with attackable systems marked.](/screenshots/conquest-starfield.png)

## Generating a map

**Conquest > Generate a map** opens a wizard. Every option below is deterministic from the **seed**. The same seed and settings always build the same map, so a good one can be rerolled or shared by its seed. The options come in this order, with the map style first because it decides which of the others apply.

| Option | What it does |
| --- | --- |
| **Game** | Which installed game the battles use. Auto-selected when only one qualifies. |
| **Map style** | **Galaxy** (stars in space), **Theatre** (a flat tactical chart), **Cities** (cities on generated land, joined by roads) or **Territories** (provinces on generated land masses). See [Map styles](#map-styles). |
| **Shape** | How the map is laid out. Galaxy and Theatre offer **Scattered**, **Spiral**, **Clusters** and **Ring**. The Galaxy style calls the first two **Scattered disc** and **Spiral arms**, and also offers **Real stars**, the real systems around Sol at their true positions. Cities and Territories shape the land instead: **One continent** that runs off one to three sides of the map, a **Coast** with land on one side of a long shoreline, **Two continents** across a strait, an **Archipelago** of islands, an **Inland sea** with land all round it, or **Landlocked** land with lakes and no sea. Land may run off the edge of the map, and the strategic map draws a darker mirror image of the map beyond its edge. **Surprise me** picks one from the seed. Every shape stays fully connected. |
| **Planet** | Cities and Territories only. Which world the land is on. See [Planets](#planets). **Surprise me** picks one from the seed. |
| **Map size** | How many locations the map has: Small (12), Medium (18), Large (28), Sprawling (40), Vast (56), Immense (80). Two larger sizes unlock with the threat levels. With Real stars this field is **Radius from Sol** instead, and every real system inside the radius is on the map. |
| **Opposition** | One to three enemy factions. Each gets its own capital, spread far from yours. |
| **Threat level** | How hard the opposing factions press. Higher levels unlock by winning. |
| **Start position** | **Edge**, with your rivals far across the map, or **Centre**, with them all around you. Centre unlocks by winning. Not offered with Real stars, where you start at Sol. |
| **Starting territory** | How much each faction begins with: **Full frontier** (the capital plus all its neighbours, the classic start) or a lean **Capital only**, **+1**, **+2** or **+3** nearest locations. A lean start still leaves something to attack on turn one. |
| **Fog of war** | Hides distant locations. See [Fog of war](#fog-of-war). |
| **Seed** | The number every other option is rolled from. Reroll for a new map. |

A **preview** under the seed shows the map you will get. A Cities or Territories preview is drawn on the same land the strategic map uses, and appears a moment after you stop changing options.

Naming (system and faction names) comes from the game's branding and any distribution profile — see [Names and factions](#names-and-factions).

## Playing

The strategic map is the whole screen. Drag to pan, scroll to zoom, right-drag to tilt. Click a system to select it; the panel shows its owner, difficulty and battlefield, and — when it's a legal move — an **Attack** or **Defend** button.

Attacking or defending zooms the camera to that system and opens the briefing over the live map. **Launch battle** starts the skirmish; on exit Coilbox reads the replay to detect the result (or asks, if it can't). One battle is one turn:

- **Attack** an enemy or neutral system adjacent to your territory. Winning captures it; losing costs only the turn.
- **Defend** when an enemy opens an **incursion** on one of your frontier systems (a warning appears top-right). Answer it before its grace runs out or the system falls without a fight — losing your capital loses the run.

Take every enemy capital to win. **Start again** resets the map with a new seed.

### Fog of war

With fog on, systems more than two jumps from your territory are hidden — dim, unnamed and unclickable, with lanes fading into the dark. Enemy starting positions are hidden too. Fog is **explored, not line-of-sight**: once a system comes into range it stays revealed for the rest of the run, even if you later lose ground. The territory tally counts only what you can see, so it never leaks enemy positions.

### Map styles

The style changes how the strategic map looks and what its locations are. The rules are the same in all four.

- **Galaxy** draws star systems joined by jump lanes over a 3D starfield.
- **Theatre** draws the same locations and links as a flat tactical chart, for a terrestrial game (a WW2 title, say) where a galaxy of stars makes no sense.
- **Cities** draws the locations as cities on generated land. The land is made first and divided into one region per city. Each city stands on the best ground in its region, which is low, away from the region's edge and near the coast where it can be. Neighbouring cities are joined by roads that keep off high mountains, and cities with sea between them by a crossing.
- **Territories** makes the land first and then divides all of it into provinces of different sizes, with borders that wander as real ones do. Provinces that share a border are neighbours, and sea crossings join the land masses.

Choose the style as **Map style** when generating. An authored map sets it through the document's theme. **Regenerate map** on a generated map builds a new one in the same style.

Theatre changes only how the map looks. Cities and Territories also change the shape of the map, because the locations sit on land and are joined by roads, borders and sea crossings. The rules for taking a location are the same in all four.

A challenge code carries the style, so whoever imports it plays the same map. A code made on a Cities or Territories map needs a Coilbox new enough to know those styles. An older one reads it as a Galaxy.

### Planets

A Cities or Territories map is built on one of seven planets. The planet decides the ground, the sea and whether the sea can be crossed. It does not change the rules.

- **Temperate** has grassland, forest, desert, tundra and snowy mountains round a blue sea.
- **Desert** has dunes, rock flats, mesas and scrub, with salt pans in its low basins and a little water.
- **Ice** has snowfields, bare ice and tundra. Its sea is a frozen sheet.
- **Red** has red dust and dark basalt. Its sea is a dry basin.
- **Moon** has grey regolith and craters. Its sea is the dark maria.
- **Volcanic** has dark basalt and ash round a sea of lava.
- **Acid** has dull yellow and brown ground and brown forest round a green acid sea.

Each kind of ground is drawn with its own surface as you zoom in: dune ridges, cracked salt, cratered regolith, blocks of basalt, a crust on the lava and cracks and ridges in the sea ice. Performance mode draws the plain colours without it.

The planet also decides what its settlements look like. Temperate, Desert and Ice are settled in the open: towns of small roofs along curving streets, with sheds at the edge and taller blocks in the middle of a large one. Red, Moon, Volcanic and Acid have sealed outposts: domes and long modules joined by tubes, with landing pads, solar arrays and greenhouses beside them. Roads follow suit. A sealed planet has wheel ruts, graded ways and a transit tube into each capital where an open one has dirt tracks and surfaced roads. A place where many roads meet grows into a city, and one at the end of a single track stays an outpost.

Towns farm the land round them where it can be farmed. Grassland gets a green patchwork with hedges. Desert's scrub gets dry country's farming: irrigated plots, fallow ones, olive groves and vineyards, with tracks between them. Nothing is farmed on dunes, on Temperate or on Desert.

Nothing crosses lava or acid, so a Volcanic or Acid map is one land mass and offers four shapes: **One continent**, **Coast**, **Inland sea** and **Landlocked**. On the other planets a crossing joins the land masses. It is a shipping lane over water, and a solid track over ice, a dry basin or the maria.

A map made before planets existed is Temperate. A challenge code carries the planet. A Coilbox from before planets ignores it and builds the Temperate map of the same seed, which for Volcanic and Acid can be a different land.

### Playing a hand-made map

A game maker can ship a map drawn by hand instead of a generated one. A hand-made map is listed on the **Conquest** page with its picture and title. A label shows where it came from: **Bundled** for a map a distribution ships, **From the game** for a map the game archive carries, or no label for a map you imported.

To import one, choose **Import map** on the Conquest page and pick the zip. If a map with the same id is installed, Coilbox asks whether to replace it. A conquest in progress on it carries on with the new map. A map the reader refuses is not installed, and the drawer lists every reason. The [hand-made maps guide](hand-made-maps.md#error-messages) explains each message.

A hand-made map has one conquest at a time. Its setup panel offers fog of war, a threat level and a seed. The size, shape and style are the map's own. The seed sets how enemies move and which battlefield each location with no set battle is fought on. The map itself never changes.

Some locations on a hand-made map play a scenario in place of a skirmish. You play it once, when you first attack there. After that, attacks on that location are skirmishes on the scenario's map.

A conquest saves the map's id and not the map. Coilbox reads the map from its folder each time, so an update to the map takes effect on a conquest in progress. A conquest cannot be opened while its map is missing. The Conquest page keeps the save and says why, and the conquest carries on once the map is back. **Remove** deletes an imported map. A map with a conquest on it offers **Abandon** instead.

Once a conquest exists on a hand-made map, its card has a share button. The challenge code names the map and its version. The other player needs the same version installed, and a player without it is told which map and game to get. See [Versions and challenge codes](hand-made-maps.md#versions-and-challenge-codes) for what makes a new version.

A game can ask for its own maps only. Then **Generate a map** does not offer that game, so a World War 2 game is never played across a galaxy. See [Hide the generated styles](hand-made-maps.md#hide-the-generated-styles).

## Names and factions

The strategic model is theme-agnostic — it speaks of *systems* and *lanes*, and "galaxy / star / faction" is presentation. Star names, faction names, and whole lore factions can be supplied so a generated galaxy reads as *your* game rather than generic space. Two sources, one schema:

1. the game's **[branding catalog](branding-catalog.md)** entry provides per-game defaults (a `conquest` field on the entry — reaches every user, no app release), and
2. a **[distribution profile](distribution-profile.md#conquest-object)**'s `conquest` field overrides those on top (for a copy you packaged).

With neither, built-in pools apply (real star names, then pronounceable invented ones; procedurally-named factions).

The schema (every field optional):

```jsonc
{
  "starNames":    ["Uros", "Ophvor", "..."],   // full system names, used first
  "starPrefixes": ["Al", "Bel", "Cyg"],         // syllables for synthesized names
  "starSuffixes": ["ara", "ion", "eth"],        // (used once starNames run out)
  "placeNames":    ["Harrowgate", "..."],       // the same three, for Cities and Territories
  "placePrefixes": ["Iron", "North"],           // (see "Land maps" below)
  "placeSuffixes": ["coast", "march"],
  "factionNames": ["Sovereign Syndicate"],      // full names, if no `factions`
  "factions": [
    {
      "name": "Sovereign Syndicate",
      "color": "#00c853",   // #rrggbb; omitted uses the built-in palette slot
      "side": "Core",       // in-game side its AI plays
      "aggression": 0.4     // 0..1 chance per turn of opening an incursion
    }
  ]
}
```

How they're used when a galaxy is generated:

- **System names** are drawn uniquely from `starNames` first (real star names by default), then synthesized from `starPrefixes` + `starSuffixes`.
- **Land maps** (the Cities and Territories styles) name their locations from `placeNames`, then from `placePrefixes` + `placeSuffixes`. Each place field falls back to the matching star field, so a game that supplies only star names gets them on every style, as before. A game that supplies neither gets built-in composed place names such as "Ironcoast" and "Northmarch", drawn from a separate random stream so the names never change where anything is placed. Galaxy and Theatre maps keep using the star fields.
- **Factions** come from `factions` presets, assigned in order with the player first. A preset wins for every field it sets; anything it omits falls back (colour to the palette, name to `factionNames` or a synthesized name). With no presets, `factionNames` (then synthesized names) supply the names and the built-in palette the colours.

Merge order per field is **profile > catalog > built-in**; an empty array is treated as absent, so an override never blanks a pool.

The bundled catalog ships this for the Total Annihilation lineage — **Balanced Annihilation**, **XTA**, and **Basically OTA** — giving each a flat pool of world names drawn from the TA campaigns and expansions (the original planets Empyrrean, Core Prime, Thalassean, Barathrum, Rougpelt, …; *Core Contingency* worlds Hydross, Lusch, Temblor, Gelidus; *Battle Tactics* locales Destral II, Yrdac, Neovestral II, …; moons such as Dump, Novaspin IV and Nayrb; a few community easter-egg names; and the *TA: Kingdoms* kingdoms Aramon, Veruna, Taros, Zhon and Creon) plus the two **Arm** / **Core** lore factions. Names are drawn from one shared pool regardless of who holds the system (ownership shifts in play), so it reads as a TA galaxy rather than mapping planets to a side. Each faction's `side` uses that game's own casing (`ARM`/`CORE` for BA and BOTA, `Arm`/`Core` for XTA) so its AI launches on the right faction; colours are left to the palette (player blue, enemy red).

## Bundling a galaxy

A conquest galaxy is a single JSON document. **Export** one from the Conquest list to share it, or drop the exported file into a distribution's `.coilbox/galaxies/` folder to ship it — it appears in Conquest as a **Bundled** galaxy, ready to play, alongside anything the player generates. Run state is stored separately, so bundled (read-only) galaxies still track progress. See [Distribution profiles](distribution-profile.md) and [Portable mode](portable-mode.md) for how the `.coilbox` folder works.

## Customising conquest for your game

If you author or maintain a game, there are five ways to make conquest feel like *yours* rather than generic space — from lightest to most involved:

- **Names and factions** — supply star/faction name pools and lore factions so a generated galaxy reads as your setting. Set them on your [branding-catalog](branding-catalog.md) entry's `conquest` field to reach every user with no app release, or in a [distribution profile](distribution-profile.md#conquest-object)'s `conquest` for a copy you package. See [Names and factions](#names-and-factions) for the schema and merge order.
- **AI rankings** — rank your AIs hardest to easiest, name the standard one, and say which are mini-games or belong on neutral worlds. A node's difficulty then picks the opponent: a frontier world is a gentler fight than an enemy capital. Set them on your [branding-catalog](branding-catalog.md#ai-rankings) entry's `ai` field, or in a [distribution profile](distribution-profile.md#ai-object).
- **Map style** — a terrestrial game where stars make no sense can use the Theatre, Cities or Territories style in place of the starfield. See [Map styles](#map-styles).
- **Ship a hand-made galaxy** — export a specific galaxy and bundle it so players get a curated campaign out of the box, alongside anything they generate. See [Bundling a galaxy](#bundling-a-galaxy).
- **Ship a hand-made map of land** — paint provinces in an image editor and describe them in a text file. A distribution can bundle the folder, a player can import it as a zip, and a game archive can carry it. See the [hand-made maps guide](hand-made-maps.md).
- **Faction AI sides / colours** — each lore faction's `side` and `color` control which in-game side its AI plays and how it's drawn on the map (see the schema in [Names and factions](#names-and-factions)).

The strategic model itself is theme-agnostic (it speaks of *systems* and *lanes*), so all of the above except the land map styles is presentation layered on identical rules.
