# Warpath

**Warpath** is a single-player mode built on the same battles as [Galactic conquest](conquest.md). You cross a map once and cannot go back. Along the way you fight AI skirmishes, take events, pick rewards and shop, and what you unlock lasts for that run only. A run ends when you beat the boss or your health runs out, and then you start a fresh one. Winning or dying unlocks options for future runs. A run and a conquest share no save.

Runs are under **Warpath** in the Play group of the sidebar. You can start one for any installed game with skirmish AIs.

## Start a run

**Warpath > New warpath** opens the setup form, and **Begin warpath** starts the run. Everything the run contains is deterministic from the **seed**, so a good run can be rerolled or replayed by its seed.

| Option | What it does |
| --- | --- |
| **Game** | Which installed game the battles use. |
| **Faction / side** | The in-game side your commander plays (also the build tree the run unlocks). |
| **Loadout** | A starting doctrine that pre-unlocks one of your commander's build branches. Only the default is available until you unlock more (see [Meta-progression](#what-carries-over-between-runs)). |
| **Length** | Quick / Standard / Long — how many columns the map has. On a Cities or Territories run the map decides the length, so this sets how many locations the generated map has. |
| **Difficulty** | 1–5. Scales enemy count and handicap and lowers your starting health. |
| **Map style** | **Galaxy** (a 3D starfield) and **Theatre** (a flat tactical chart) draw the run in columns. **Cities** and **Territories** generate a land map and the run crosses it from one side to the other, location by location. The seed picks the shape of the land: one continent, a coast, two continents, an archipelago, an inland sea or landlocked land with lakes. Pick one of the last three for a terrestrial game where a galaxy of stars makes no sense. |
| **Planet** | Cities and Territories only. Which world the land is on: Temperate, Desert, Ice, Red, Moon, Volcanic or Acid. It decides the ground, the sea, the settlements and the place names, as it does in [Conquest](conquest.md#planets). **Surprise me** picks one from the seed. The Warpath list shows the planet under the run. |
| **Ascension** | An extra difficulty tier on top, unlocked by winning (hidden until you have one). |
| **Seed** | The number the whole run is rolled from. Reroll for a new run. |

## How a run plays

A run is a forward-only graph of columns. You occupy one node; once it's resolved you pick one of its forward neighbours and cross to it. Node types:

- **Battle / Elite / Boss** — AI skirmishes launched exactly like any other. Elite is harder for a richer reward; the boss is the run's finale. Winning banks **Salvage**; losing costs **health** (a retreat, not instant death — you press on) and the run ends only when health hits zero.
- **Reward** — choose one of several: a unit-branch **unlock** or a personal **perk**.
- **Event** — a text card with choices that mutate run state (gain a perk, trade health, take salvage). No battle.
- **Shop** — spend Salvage on unlocks and perks, and rest to repair health.

Coilbox reads the replay to detect each battle's result (or asks, if it can't). The health pool also buffers that ambiguity — a mis-read result costs some health, not the whole run. The run saves after every node, so you can leave and resume from **Warpath**.

## Unlocks and perks

A run's soul is build variety, and here your build grows by **unlocking units**. The engine only speaks *restriction* — `[RESTRICT]` in the start script disables units, and it is **engine-global** (it applies to every team, not just yours). So the run models unlocking as the complement of that ban-list: the disabled set is everything reachable in your commander's build tree *minus* what you've unlocked.

The consequence, by design: a unit unlock raises a **shared tech ceiling**. The war escalates as you descend — the enemy fields the same tech you unlock — and your agency is *which* branch you commit to, not exclusive access to it. You start able to build a small connected kit (commander, economy, a first factory); rewards and shops widen it along the game's real build tree, and each unlock grants a whole buildable branch rather than a stranded unit.

Because the ceiling is shared, personal power comes from **perks** instead: per-team levers the engine does support — a resource **Advantage** or an **Income** multiplier applied to your commander alone. Reward cards mark which is which ("raises tech ceiling · both sides" versus "you only").

## How long a run takes

RTS battles are long, so battles are scarce punctuation and the cheap nodes carry the rhythm. Depth is one dial: early columns are small maps with a low tech ceiling (a short skirmish); the boss is a large map with the full arsenal. A Quick run is meant to fit one evening.

## What carries over between runs

Winning or dying unlocks **options, not raw power**, kept in a separate meta document so runs stay fair and self-contained:

- **Loadouts** — new starting doctrines (unlocked by wins) that open a run pre-committed to a build branch.
- **Event pools** — extra event content drawn into the deck as you play more runs.
- **Ascension** — one harder difficulty tier per win at the current ceiling, so the challenge can't be outrun.

## Warpath on a land map

On a Cities or Territories map the run crosses land from a start location to a goal, with no way back. Coilbox ranks every location by how many links it is from the start. You can step only to a neighbour one rank further on. A location on no route to the goal is scenery. It is drawn but has no fight and cannot be chosen.

A generated map always offers a choice of route. The seed picks the start and goal among the furthest pairs, takes the pair that gives the most choice, and builds the next map from the seed if a map has none.

A hand-made map shows in **Map style** as "Title (hand-made map)" when its author marked a start and a goal for Warpath. Its author also sets where the run starts and ends and what some locations are. A hand-made run is drawn in the Theatre style and has no **Length** choice, because the map decides both.

A location the author gave a battle fights that battle. Its map, enemy count, AI, handicap, start positions, mod options and disabled units replace the generated ones where the author set them. A location with a scenario plays it as its author set it up, without your unit limit or perks. See [Warpath markings](../developers/hand-made-maps.md#warpath-markings) for the author's side.

A challenge code carries the planet. A Coilbox from before Warpath had planets ignores it and builds the Temperate map of the same seed, which for Volcanic and Acid can be a different land and so a different run. A run started before then is on Temperate.

A run saves a reference to its map. If the map is missing, unreadable or changed so the run no longer fits, the run plays in columns and the run page says why. A challenge code on a hand-made map needs the same version of the map installed.
