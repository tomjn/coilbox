# Set up conquest for your game

This page is for people who make or maintain a game. It covers the names, factions and maps a game can supply so that [Galactic conquest](../players/conquest.md) reads as that game's own setting. Players do not need any of it.

## Ways to customise conquest

If you author or maintain a game, there are five ways to make conquest feel like *yours* rather than generic space — from lightest to most involved:

- **Names and factions** — supply star/faction name pools and lore factions so a generated galaxy reads as your setting. Set them on your [branding-catalog](branding-catalog.md) entry's `conquest` field to reach every user with no app release, or in a [distribution profile](distribution-profile.md#conquest-object)'s `conquest` for a copy you package. See [Names and factions](#names-and-factions) for the schema and merge order.
- **AI rankings** — rank your AIs hardest to easiest, name the standard one, and say which are mini-games or belong on neutral worlds. A node's difficulty then picks the opponent: a frontier world is a gentler fight than an enemy capital. Set them on your [branding-catalog](branding-catalog.md#ai-rankings) entry's `ai` field, or in a [distribution profile](distribution-profile.md#ai-object).
- **Map style** — a terrestrial game where stars make no sense can use the Theatre, Cities or Territories style in place of the starfield. See [Map styles](../players/conquest.md#map-styles).
- **Ship a hand-made galaxy** — export a specific galaxy and bundle it so players get a curated campaign out of the box, alongside anything they generate. See [Bundling a galaxy](#bundle-a-galaxy).
- **Ship a hand-made map of land** — paint provinces in an image editor and describe them in a text file. A distribution can bundle the folder, a player can import it as a zip, and a game archive can carry it. See the [hand-made maps guide](hand-made-maps.md).
- **Faction AI sides / colours** — each lore faction's `side` and `color` control which in-game side its AI plays and how it's drawn on the map (see the schema in [Names and factions](#names-and-factions)).

The strategic model itself is theme-agnostic (it speaks of *systems* and *lanes*), so all of the above except the land map styles is presentation layered on identical rules.

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
- **Land maps** (the Cities and Territories styles) name their locations from `placeNames`, then from `placePrefixes` + `placeSuffixes`. Each place field falls back to the matching star field, so a game that supplies only star names gets them on every style, as before. A game that supplies neither gets built-in place names composed from two lists, and each [planet](../players/conquest.md#planets) has its own pair. They are drawn from a separate random stream so the names never change where anything is placed. Galaxy and Theatre maps keep using the star fields.
- **Factions** come from `factions` presets, assigned in order with the player first. A preset wins for every field it sets; anything it omits falls back (colour to the palette, name to `factionNames` or a synthesized name). With no presets, `factionNames` (then synthesized names) supply the names and the built-in palette the colours.

Merge order per field is **profile > catalog > built-in**; an empty array is treated as absent, so an override never blanks a pool.

The bundled catalog ships this for the Total Annihilation lineage — **Balanced Annihilation**, **XTA**, and **Basically OTA** — giving each a flat pool of world names drawn from the TA campaigns and expansions (the original planets Empyrrean, Core Prime, Thalassean, Barathrum, Rougpelt, …; *Core Contingency* worlds Hydross, Lusch, Temblor, Gelidus; *Battle Tactics* locales Destral II, Yrdac, Neovestral II, …; moons such as Dump, Novaspin IV and Nayrb; a few community easter-egg names; and the *TA: Kingdoms* kingdoms Aramon, Veruna, Taros, Zhon and Creon) plus the two **Arm** / **Core** lore factions. Names are drawn from one shared pool regardless of who holds the system (ownership shifts in play), so it reads as a TA galaxy rather than mapping planets to a side. Each faction's `side` uses that game's own casing (`ARM`/`CORE` for BA and BOTA, `Arm`/`Core` for XTA) so its AI launches on the right faction; colours are left to the palette (player blue, enemy red).

## Bundle a galaxy

A conquest galaxy is a single JSON document. **Export** one from the Conquest list to share it, or drop the exported file into a distribution's `.coilbox/galaxies/` folder to ship it — it appears in Conquest as a **Bundled** galaxy, ready to play, alongside anything the player generates. Run state is stored separately, so bundled (read-only) galaxies still track progress. See [Distribution profiles](distribution-profile.md) and [Portable mode](../players/portable-mode.md) for how the `.coilbox` folder works.
