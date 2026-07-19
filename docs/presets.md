# Battle presets

A **preset** is a saved battle setup you can reload and refight later. Presets live in one place — the **Singleplayer → Presets** drawer — but you can *save into* that library from several places across Coilbox, so a good multiplayer match, or a conquest/warpath fight you just had, can be kept and replayed on your own.

## Saving a preset

Look for the **bookmark** control. It's available on:

| Where | What it captures |
| --- | --- |
| **Singleplayer** → Presets drawer → *Save current setup* | The setup you've built on the page. |
| **Multiplayer battle room** → *Save as skirmish preset* | The live battle, converted to a solo skirmish (see below). |
| **Galactic conquest** → the bookmark box in the gutter beside a node's battle overlay | The node's matchup, map, opponents and any unit restrictions. |
| **Warpath** → the bookmark box in the gutter beside an encounter overlay | The encounter's matchup plus the run's tech restrictions and perks. |

On the conquest and warpath overlays the bookmark sits in its own box just under the back arrow, so it's there **before and after** the fight. Saving asks for a name (pre-filled with something sensible like the map and opponent) and drops the preset into your Singleplayer presets; a toast confirms it, and the **bookmark fills in** so you can see this battle is already kept. Saving *after* the fight captures it *as you fought it* — not the node's next state, which may already have changed.

## Replaying a preset

Open **Singleplayer**, click **Presets**, and pick one. It loads the game, map, opponents and options into the launcher, ready to **Start Game**. Every saved battle — wherever it came from — replays as a singleplayer skirmish.

## What a preset holds

- The **game** and **map**.
- The **opponents**: each AI (or converted player), its faction/side, colour, team and handicap.
- **Mod options** and the **start-position** mode.
- **Faithful-replay restrictions**, when the source battle had them:
  - **Disabled units** — a shared unit ban (conquest node restrictions, warpath's tech ceiling, or a multiplayer host's unit restrictions).
  - **Advantage / income** — warpath's personal perks, re-applied to your team.

When a loaded preset carries restrictions, the Singleplayer page shows a small **"Restricted battle"** banner summarising them (e.g. *"12 units disabled · +15% advantage"*). Restrictions are otherwise invisible in the editor, so the banner makes them explicit — press **Clear** to drop them and fight the same matchup unrestricted.

## Saving a multiplayer battle

A singleplayer skirmish has one human (you) and AIs, so a multiplayer battle is *converted* when saved:

- **You** stay yourself, keeping your team, ally, side and colour.
- **Every other human** becomes an AI opponent or ally on a real playing AI, keeping their team, ally, side and colour — so a 4v4 stays a 4v4.
- **Bots** keep their AI where it's installed locally; an unknown AI falls back to a working one so the replay still launches.
- **Spectators** are dropped — they weren't fighting.
- **Host unit restrictions** carry over as the disabled-unit set.

This is separate from the host-only **Option presets** in the battle room, which save only mod/map options for re-hosting — not the whole battle.

## Sharing presets

In the Singleplayer presets drawer, each preset has a **Share** action that exports it to a `.json` file, and **Import** reads one back in (validated, with fresh identity so it never collides with an existing preset). Restrictions travel with the file, so a shared conquest or warpath fight refights faithfully on someone else's machine.
