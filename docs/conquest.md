# Galactic Conquest

**Galactic Conquest** is a single-player campaign across a map of star systems. You start holding a capital and a little territory; you win skirmishes to capture adjacent systems, defend against enemy incursions, and take every enemy capital to conquer the galaxy. Each system is a full skirmish (map, game, AI opponents scaled to that system's difficulty); playing one launches it like any other skirmish, and on exit Coilbox works out win/loss and advances the map.

Conquests live under **Conquest** in the sidebar. You can generate one for any installed game, or play a galaxy a distribution ships (see [Bundling a galaxy](#bundling-a-galaxy)).

![The strategic map: named star systems joined by lanes over a 3D starfield, with attackable systems marked.](/screenshots/conquest-starfield.png)

## Generating a galaxy

**Conquest > Generate a galaxy** opens a wizard. Every option below is deterministic from the **seed** — the same seed and settings always build the same galaxy, so a good one can be rerolled or shared by its seed.

| Option | What it does |
| --- | --- |
| **Game** | Which installed game the battles use. Auto-selected when only one qualifies. |
| **Galaxy size** | System count: Small (12), Medium (18), Large (28), Sprawling (40), Vast (56), Immense (80). |
| **Opposition** | One to three enemy factions. Each gets its own capital, spread far from yours. |
| **Shape** | The node layout: **Scattered disc**, **Spiral arms**, **Clusters**, **Ring**, or **Surprise me** (picks one from the seed). All stay fully connected. |
| **Map style** | **Galaxy** (a 3D starfield) or **Theatre map** (a flat tactical chart) — see [Theatre skin](#theatre-skin). |
| **Starting systems** | How much territory each faction begins with: **Full frontier** (the capital plus all its neighbours, the classic start) or a lean **Capital only** / **+1** / **+2** / **+3** nearest systems. A lean start still leaves something to attack on turn one. |
| **Fog of war** | Hides distant systems — see [Fog of war](#fog-of-war). |
| **Seed** | The number every other option is rolled from. Reroll for a new galaxy. |

Naming (system and faction names) comes from the game's branding and any distribution profile — see [Names and factions](#names-and-factions).

## Playing

The strategic map is the whole screen. Drag to pan, scroll to zoom, right-drag to tilt. Click a system to select it; the panel shows its owner, difficulty and battlefield, and — when it's a legal move — an **Attack** or **Defend** button.

Attacking or defending zooms the camera to that system and opens the briefing over the live map. **Launch battle** starts the skirmish; on exit Coilbox reads the replay to detect the result (or asks, if it can't). One battle is one turn:

- **Attack** an enemy or neutral system adjacent to your territory. Winning captures it; losing costs only the turn.
- **Defend** when an enemy opens an **incursion** on one of your frontier systems (a warning appears top-right). Answer it before its grace runs out or the system falls without a fight — losing your capital loses the run.

Take every enemy capital to win. **Start again** resets the galaxy with a new seed.

### Fog of war

With fog on, systems more than two jumps from your territory are hidden — dim, unnamed and unclickable, with lanes fading into the dark. Enemy starting positions are hidden too. Fog is **explored, not line-of-sight**: once a system comes into range it stays revealed for the rest of the run, even if you later lose ground. The territory tally counts only what you can see, so it never leaks enemy positions.

### Theatre skin

A **theatre** galaxy renders the strategic layer as a flat tactical chart instead of a starfield — appropriate for a terrestrial game (e.g. a WW2 title) where a galaxy of stars makes no sense. Choose it as **Map style** when generating, or ship it on an authored galaxy via the document's theme. It's presentation only; the rules are identical.

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
- **Factions** come from `factions` presets, assigned in order with the player first. A preset wins for every field it sets; anything it omits falls back (colour to the palette, name to `factionNames` or a synthesized name). With no presets, `factionNames` (then synthesized names) supply the names and the built-in palette the colours.

Merge order per field is **profile > catalog > built-in**; an empty array is treated as absent, so an override never blanks a pool.

The bundled catalog ships this for the Total Annihilation lineage — **Balanced Annihilation**, **XTA**, and **Basically OTA** — giving each a flat pool of world names drawn from the TA campaigns and expansions (the original planets Empyrrean, Core Prime, Thalassean, Barathrum, Rougpelt, …; *Core Contingency* worlds Hydross, Lusch, Temblor, Gelidus; *Battle Tactics* locales Destral II, Yrdac, Neovestral II, …; moons such as Dump, Novaspin IV and Nayrb; a few community easter-egg names; and the *TA: Kingdoms* kingdoms Aramon, Veruna, Taros, Zhon and Creon) plus the two **Arm** / **Core** lore factions. Names are drawn from one shared pool regardless of who holds the system (ownership shifts in play), so it reads as a TA galaxy rather than mapping planets to a side. Each faction's `side` uses that game's own casing (`ARM`/`CORE` for BA and BOTA, `Arm`/`Core` for XTA) so its AI launches on the right faction; colours are left to the palette (player blue, enemy red).

## Bundling a galaxy

A conquest galaxy is a single JSON document. **Export** one from the Conquest list to share it, or drop the exported file into a distribution's `.coilbox/galaxies/` folder to ship it — it appears in Conquest as a **Bundled** galaxy, ready to play, alongside anything the player generates. Run state is stored separately, so bundled (read-only) galaxies still track progress. See [Distribution profiles](distribution-profile.md) and [Portable mode](portable-mode.md) for how the `.coilbox` folder works.

## Customising conquest for your game

If you author or maintain a game, there are four ways to make conquest feel like *yours* rather than generic space — from lightest to most involved:

- **Names and factions** — supply star/faction name pools and lore factions so a generated galaxy reads as your setting. Set them on your [branding-catalog](branding-catalog.md) entry's `conquest` field to reach every user with no app release, or in a [distribution profile](distribution-profile.md#conquest-object)'s `conquest` for a copy you package. See [Names and factions](#names-and-factions) for the schema and merge order.
- **Theatre skin** — render the strategic layer as a flat tactical chart instead of a starfield, for a terrestrial game where stars make no sense. See [Theatre skin](#theatre-skin).
- **Ship a hand-made galaxy** — export a specific galaxy and bundle it so players get a curated campaign out of the box, alongside anything they generate. See [Bundling a galaxy](#bundling-a-galaxy).
- **Faction AI sides / colours** — each lore faction's `side` and `color` control which in-game side its AI plays and how it's drawn on the map (see the schema in [Names and factions](#names-and-factions)).

The strategic model itself is theme-agnostic (it speaks of *systems* and *lanes*), so all of the above is presentation layered on identical rules.
