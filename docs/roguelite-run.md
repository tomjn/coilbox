# Roguelite Run

A **Roguelite Run** is a single-player play-mode that rides the galactic-conquest battle engine. You cross a forward-only node map once — fighting AI skirmishes, taking events, picking rewards and shopping — growing a run-scoped build until a boss ends it or your hull runs out. A run is short-lived and disposable: win or die, then start a fresh one. Winning or dying unlocks options for future runs.

Runs live under **Run** in the sidebar, next to Conquest. You can start one for any installed game with skirmish AIs.

## Starting a run

**Run > Begin run** sets one up. Everything the run contains is deterministic from the **seed**, so a good run can be rerolled or replayed by its seed.

| Option | What it does |
| --- | --- |
| **Game** | Which installed game the battles use. |
| **Faction / side** | The in-game side your commander plays (also the build tree the run unlocks). |
| **Loadout** | A starting doctrine that pre-unlocks one of your commander's build branches. Only the default is available until you unlock more (see [Meta-progression](#meta-progression)). |
| **Length** | Quick / Standard / Long — how many columns the map has. |
| **Difficulty** | 1–5. Scales enemy count and handicap and lowers your starting hull. |
| **Map style** | **Galaxy** (a 3D starfield) or **Theatre** (a flat tactical chart) — pick theatre for a terrestrial game where a galaxy of stars makes no sense. |
| **Ascension** | An extra difficulty tier on top, unlocked by winning (hidden until you have one). |
| **Seed** | The number the whole run is rolled from. Reroll for a new run. |

## How it plays

A run is a forward-only graph of columns. You occupy one node; once it's resolved you pick one of its forward neighbours and cross to it. Node types:

- **Battle / Elite / Boss** — AI skirmishes launched exactly like any other. Elite is harder for a richer reward; the boss is the run's finale. Winning banks **Salvage**; losing costs **hull** (a retreat, not instant death — you press on) and the run ends only when hull hits zero.
- **Reward** — choose one of several: a unit-branch **unlock** or a personal **perk**.
- **Event** — a text card with choices that mutate run state (gain a perk, trade hull, take salvage). No battle.
- **Shop** — spend Salvage on unlocks and perks, and rest to repair hull.

Coilbox reads the replay to detect each battle's result (or asks, if it can't). The hull pool also buffers that ambiguity — a mis-read result costs some hull, not the whole run. The run saves after every node, so you can leave and resume from **Run**.

## The build: unlocks as a shared ceiling

A run's soul is build variety, and here your build grows by **unlocking units**. The engine only speaks *restriction* — `[RESTRICT]` in the start script disables units, and it is **engine-global** (it applies to every team, not just yours). So the run models unlocking as the complement of that ban-list: the disabled set is everything reachable in your commander's build tree *minus* what you've unlocked.

The consequence, by design: a unit unlock raises a **shared tech ceiling**. The war escalates as you descend — the enemy fields the same tech you unlock — and your agency is *which* branch you commit to, not exclusive access to it. You start able to build a small connected kit (commander, economy, a first factory); rewards and shops widen it along the game's real build tree, and each unlock grants a whole buildable branch rather than a stranded unit.

Because the ceiling is shared, personal power comes from **perks** instead: per-team levers the engine does support — a resource **Advantage** or an **Income** multiplier applied to your commander alone. Reward cards mark which is which ("raises tech ceiling · both sides" versus "you only").

## Pacing

RTS battles are long, so battles are scarce punctuation and the cheap nodes carry the rhythm. Depth is one dial: early columns are small maps with a low tech ceiling (a short skirmish); the boss is a large map with the full arsenal. A Quick run is meant to fit one evening.

## Meta-progression

Winning or dying unlocks **options, not raw power**, kept in a separate meta document so runs stay fair and self-contained:

- **Loadouts** — new starting doctrines (unlocked by wins) that open a run pre-committed to a build branch.
- **Event pools** — extra event content drawn into the deck as you play more runs.
- **Ascension** — one harder difficulty tier per win at the current ceiling, so the challenge can't be outrun.

## Rendering

The run map reuses the conquest galaxy renderer's toolkit with a forward-column layout: a starfield backdrop with node tokens coloured by type and lanes lit forward (amber where you've been, cyan for your open choices). The **theatre** skin swaps the starfield for a flat tactical grid, for terrestrial games.

## Relationship to Conquest

A run is built deliberately *on top of* [Galactic Conquest](conquest.md) — it reuses conquest's battle synthesis, replay result detection, seeded generation and the 3D renderer — but its schema and rules are its own: a run is a disposable forward path, not a persistent territory galaxy. The two modes share no save state.
