# Teaching your game with a campaign

A distribution can teach its game. You write missions in the scenario editor, put them in a campaign, bundle the campaign with your distribution profile, and name it in the profile's `start` field. A new player then sees a "Start here" card on the home page that opens the first lesson.

This page follows that route in order. Each step links to the page that covers it in full.

## What you need first

- A game that coilbox can play scenarios on. The game archive must bundle the coilbox mission runtime, with the guards described in [the adoption contract](mission-runtime.md#the-adoption-contract). A game that ships its missions in its own archive plays them whatever its archive format. See [Ship missions in your game](scenarios.md#ship-missions-in-your-game).
- A distribution that ships `.coilbox/profile.json`. See [Distribution profiles](distribution-profile.md) and [Distributing coilbox with your game](distributing.md).
- Advanced mode, which you turn on in Settings > General. The Scenario Builder and Campaign Builder are in the sidebar once it is on.

## What a teaching mission can use today

Each of these exists in the scenario editor now.

| You want to | Use | Documented in |
| --- | --- | --- |
| Tell the player what to do | Objectives, settled by the `complete_objective` and `fail_objective` actions | [Objectives](scenarios.md#objectives) |
| Show the player where to look | The `camera_pan` action, which moves the camera to a point over a number of seconds | [Actions](scenarios.md#actions) |
| Mark a place on the map | The `map_marker` action, with an optional label | [Actions](scenarios.md#actions) |
| Stop the player using a unit or building | Scenario restrictions, which `unlock_unit` can lift later. A campaign mission also has a plain **Restricted Units** list | [Restrictions](scenarios.md#restrictions) and [Unit restrictions](campaigns.md#unit-restrictions) |

Two other things help a lesson.

- Dialogue lines, which are radio messages with a speaker, text, and an optional portrait and voice clip. See [Dialogue and sound](scenarios.md#dialogue-and-sound).
- Conditions that notice what the player did, such as `unit_selected` (selected a unit), `command_given` (gave an order), `units_in_zone` (walked somewhere) and `unit_built` (built something). See [Conditions](scenarios.md#conditions).
- A way to stop and wait. A `dialogue` action can keep its line on screen until the player clicks it away, `pause_game` stops the game while they read, and the `dialogue_dismissed` condition carries on afterwards. A game's bundled mission runtime must be version 9 or later. See [Stop and wait for the player](scenarios.md#stop-and-wait-for-the-player).

### Two kinds of unit ban

A scenario restriction is enforced by the mission runtime, can be lifted mid-mission, and shows forbidden build icons greyed out. The mission's **Restricted Units** list is the engine's `[RESTRICT]` block. It is permanent for the mission and cannot be lifted. Both bind every team, including the enemy. Use a scenario restriction for a lesson that unlocks things as the player learns them.

### What a lesson cannot do yet

- **It cannot pause a multiplayer game.** `pause_game` works in single player only, because a pause stops the game for everyone in it. A held dialogue line works in both.
- **A paused lesson only moves when the player acts.** A paused game runs no clock, so a trigger that waits on time does nothing until the game is running again. Unpause from a trigger that waits on `dialogue_dismissed`. See [Stop and wait for the player](scenarios.md#stop-and-wait-for-the-player).
- **A bundled campaign plays its radio messages silent.** The portraits and voice clips do not travel with a bundled campaign. See [Bundling a campaign in a distribution](campaigns.md#bundling-a-campaign-in-a-distribution) and [issue #877](https://github.com/tomjn/coilbox/issues/877).
- **Nobody has watched the objectives and dialogue panels drawn in a real engine.** See [What a scenario cannot do yet](scenarios.md#what-a-scenario-cannot-do-yet).

## Step 1: write the missions

Write one scenario per lesson in the [Scenario Builder](scenarios.md#author-a-scenario). Keep each lesson to one idea. Give it one primary objective that says what to do, and use triggers to move the player on.

The example below has two lessons.

1. **Move your builder.** The player walks a unit into a marked zone.
2. **Build a power plant.** The player builds one, and the mission unlocks a second building.

This is the part of the first scenario that matters for teaching. It is the scenario document's JSON, with the setup, actors and map details left out. Field names are those of the real model in `src/scenario/model.ts`. The participant `p1` is the human player, and the zone id is the one the editor mints.

```json
{
  "zones": [
    {
      "id": "zone-pad",
      "name": "Landing pad",
      "shape": "circle",
      "center": { "x": 2400, "z": 1800 },
      "radius": 300
    }
  ],
  "restrictions": {
    "buildable": { "mode": "allow", "units": ["armsolar"] }
  },
  "objectives": [
    {
      "id": "reach-pad",
      "kind": "primary",
      "text": "Move your builder to the marked landing pad.",
      "hidden": false
    }
  ],
  "dialogue": [
    {
      "id": "welcome",
      "speaker": "Trainer",
      "text": "Welcome. Look at the marker on the map and move your builder there."
    }
  ],
  "triggers": [
    {
      "id": "intro",
      "name": "Introduction",
      "enabled": true,
      "repeat": false,
      "conditions": { "op": "all", "conditions": [] },
      "actions": [
        { "type": "dialogue", "params": { "line": "welcome" } },
        { "type": "camera_pan", "params": { "pos": { "x": 2400, "z": 1800 }, "seconds": 2 } },
        { "type": "map_marker", "params": { "pos": { "x": 2400, "z": 1800 }, "text": "Landing pad" } }
      ]
    },
    {
      "id": "arrived",
      "name": "Builder reaches the pad",
      "enabled": true,
      "repeat": false,
      "conditions": {
        "op": "all",
        "conditions": [
          { "type": "units_in_zone", "params": { "zone": "zone-pad", "team": "p1", "min": 1 } }
        ]
      },
      "actions": [
        { "type": "complete_objective", "params": { "objective": "reach-pad" } },
        { "type": "victory", "params": {} }
      ]
    }
  ]
}
```

A trigger with no conditions fires as soon as the mission starts, which is how `intro` runs. The editor writes ids for zones, groups and some other things as UUIDs. The short ids here only keep the example readable. Unit names such as `armsolar` are your game's internal names.

The second scenario follows the same shape. Its objective reads "Build a solar panel", its condition is `unit_built` with `team: "p1"`, `unitDef: "armsolar"` and `count: 1`, and its actions complete the objective, unlock the next building and end the mission:

```json
{
  "type": "unlock_unit",
  "params": { "unitDef": "armmex", "team": "p1" }
}
```

Leave `victory` without a team unless you mean it. The campaign reads the result from the player's own ally team, so a `victory` that names someone else records a defeat. See [Win and loss](scenarios.md#win-and-loss).

Use **Test in game** in the editor to play each scenario before you go on. See [Test and play](scenarios.md#test-and-play).

## Step 2: put the missions in a campaign

Create a campaign in the Campaign Builder, add a mission for each lesson, and attach each scenario to its mission. Missions play in the order you list them. See [Authoring a campaign](campaigns.md#authoring-a-campaign) and [Missions that play a scenario](campaigns.md#missions-that-play-a-scenario).

Attaching copies the scenario into the mission. If you edit the scenario later, use **Update to latest** on the mission.

Write the mission briefing in Markdown. The briefing is what the player reads before the game starts, so say there what the lesson teaches.

Export the campaign when it is ready. The exported file has this shape, shown with the setup and scenario left out:

```json
{
  "schemaVersion": 1,
  "id": "6f1e0a52-3c1d-4a77-8a52-0c6a5d1b9e10",
  "type": "ta",
  "title": "Learn the basics",
  "description": "Two short lessons that teach movement and building.",
  "missions": [
    {
      "id": "0c5e8d1a-27b4-4d2e-9b1f-5a3c7e9d2f01",
      "title": "Move your builder",
      "subtitle": "Lesson 1",
      "briefing": "Learn to move a unit by sending your builder to the landing pad.",
      "objectives": ["Move your builder to the marked landing pad."],
      "snapshot": { "...": "the mission's skirmish setup" },
      "scenario": { "...": "the first scenario document" },
      "disabledUnits": [],
      "skippable": false
    },
    {
      "id": "b7a2c4e9-91d3-4f60-8e27-3d5f1a6b8c02",
      "title": "Build a power plant",
      "subtitle": "Lesson 2",
      "briefing": "Learn to build by putting up a solar panel.",
      "objectives": ["Build a solar panel."],
      "snapshot": { "...": "the mission's skirmish setup" },
      "scenario": { "...": "the second scenario document" },
      "disabledUnits": [],
      "skippable": false
    }
  ],
  "createdAt": "2026-10-04T09:00:00.000Z",
  "updatedAt": "2026-10-04T09:00:00.000Z"
}
```

Coilbox writes `snapshot`, `scenario`, the ids and the dates for you. Do not write them by hand. Export from the Campaign Builder, and the file arrives complete. See [Export / import](campaigns.md#export--import).

## Step 3: bundle the campaign with the profile

Save the exported file as `.coilbox/campaigns/<any-name>.json` beside your profile. Any media referenced by relative path goes under `.coilbox/` too.

```
<YourGameFolder>/
  .coilbox/
    profile.json
    campaigns/
      learn-the-basics.json
```

Bundled campaigns are read-only and play like any other. See [Bundling a campaign in a distribution](campaigns.md#bundling-a-campaign-in-a-distribution).

## Step 4: name it as the starting point

Add a `start` field to `.coilbox/profile.json`. `campaign` is the `id` inside the campaign file, not its title or file name.

```json
{
  "version": 1,
  "start": { "campaign": "6f1e0a52-3c1d-4a77-8a52-0c6a5d1b9e10" }
}
```

`mission` is optional. Leave it out and the card opens the campaign's first mission. To start somewhere else, give the `id` of one of its missions:

```json
{
  "version": 1,
  "start": {
    "campaign": "6f1e0a52-3c1d-4a77-8a52-0c6a5d1b9e10",
    "mission": "b7a2c4e9-91d3-4f60-8e27-3d5f1a6b8c02"
  }
}
```

The full rules are in [`start`](distribution-profile.md#start-object). The ones that catch people out:

- The home page card sits in the `continue` zone. A `home.zones` list that leaves out `continue`, or a `welcome` page, hides it.
- Only a campaign you bundle counts. A campaign that exists only on your machine does not.
- The card stays until the player wins that mission.

If you have one lesson and do not want a campaign around it, `start` can name a bundled scenario instead. Put the scenario's export in `.coilbox/scenarios/` and write `"start": { "scenario": "<scenario id>" }`. The card then opens the Scenarios page and stays until the player wins the scenario. See [Starting on a scenario](distribution-profile.md#starting-on-a-scenario).

## Check that it works

1. Run coilbox from your distribution folder, using a fresh profile with no progress.
2. Open Settings > Distribution profile. The `start` row of the health checklist says what `start` resolved to, or why it did not.
3. Open the home page. The "Start here" card shows the campaign and mission titles.
4. Press the card, then Start Mission, and play the lesson through.

If the card is missing, the `start` row gives the reason.
