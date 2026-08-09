# Scenarios

A **scenario** is authored content the engine plays: where the units start, what the zones are, what happens when the player reaches one, what they are being asked to do, and who says what along the way. Coilbox's campaigns stop at the engine boundary, so a campaign mission on its own is a skirmish setup with a briefing over it. A scenario is the other half, and it runs inside the game.

The **Scenario Builder** is an advanced-mode tool: turn on Advanced mode in Settings > General and it appears in the sidebar in its own group, with **Builder** inside it. A scenario you can play also shows up under Play > **Scenarios**.

Two things to know before you spend an evening on this:

- **The game has to have adopted coilbox's mission runtime**, or the scenario is played through a generated test game instead. That works, and it is how you develop a mission, but it is a test route and never a way to ship one. See [Which game can play it](#which-game-can-play-it).
- **Scenarios are single player.** Nothing stops you giving a scenario several human participants, but nothing has been built or tested for it, and two of the actions ignore teams entirely ([issue #827](https://github.com/tomjn/coilbox/issues/827)).

## Scenario, mission, campaign

Three words that sound alike and mean different things:

- A **scenario** is the in-engine content. It carries its own skirmish setup (game, map, participants, mod options) alongside spawns, zones, triggers, objectives and dialogue. It is a standalone document, playable on its own from the Scenarios page.
- A **mission** wraps a scenario and adds presentation: the briefing text, panorama, side graphic, voiceover and cutscene the player sees before the engine starts. Missions live inside campaigns. See [Campaigns](campaigns.md).
- A **campaign** is an ordered list of missions, unchanged by any of this.

A mission does not have to have a scenario. A mission built from a preset alone is the kind campaigns have always had, and it still plays as an ordinary skirmish.

## Which game can play it

A scenario is played by coilbox's [mission runtime](mission-runtime.md), a set of Lua files a game vendors. Which route your scenario takes is decided per launch, and coilbox tells you which one it picked before you press the button:

- **The game vendors the runtime.** The compiled mission is written into the game's own `missions/` folder and the game is launched as itself. This is the route a shipped scenario is meant to take.
- **Anything else** goes through the **test mutator**: coilbox writes a small game of its own, `coilbox-mission-test.sdd`, into your content root's `games/` folder. It depends on the game you set the scenario in for units, sides and everything else, and adds coilbox's runtime plus the one scenario under test. Your install is not touched, and deleting that folder undoes everything the flow has ever written.

A packaged `.sd7` or `.sdz` game always takes the mutator route, because a packaged archive cannot be written into. For a game to play scenarios itself it needs a loose `.sdd` copy with the runtime installed, which is done from Content > Games. See [the mission runtime](mission-runtime.md).

## Author a scenario

Go to **Scenario Builder > Builder** and press **New scenario**. Give it a name and, if you like, a description.

### Set the game and map

A new scenario has no game and no map, and the editor cannot draw anything until it does. Press **Set up from preset** and pick a saved singleplayer preset. That copies the whole setup in: game, map, participants, start position type and mod options.

So the fastest start is to go to **Play > Singleplayer** first, configure the game, map, teams and AI you want, and save it as a preset. Picking a preset again later, with **Change setup**, replaces the setup and clears the per-team settings, because those are keyed to the participants the old preset had.

Setting a scenario's game and map without a preset is not possible yet: [issue #821](https://github.com/tomjn/coilbox/issues/821).

### The map scene

The map is drawn as a 3D scene from the same terrain data the content browser previews maps with. Everything you place is drawn with its real game model.

- **Drag** or **middle-drag** to pan, **right-drag** to turn, **scroll** to zoom toward the cursor.
- **Frame map** puts the camera back where it opened.
- A unit type the game does not have is drawn as a plain box, and the count of those is written in the corner so you know it is a missing unit rather than a placement you forgot.

### The mode strip

The toggle group above the scene decides what a click on the ground does:

| Mode | What it does |
| --- | --- |
| **Select** | Nothing is placed. Click bare ground to deselect. |
| **Zones** | Drag to draw a zone. Pick **Box** or **Circle** first. |
| **Actors** | Pick a unit and a team, then click to place one unit. |
| **Groups** | Pick a unit, a team and a count, then click to place a block of them. |
| **Bases** | Pick a building and click. Clicks add to the base you have selected, or press **New base** to start another. |

Nothing is placed until you have picked a unit, so a stray click in Actors mode with an empty picker just deselects.

In Zones mode the left button is taken by the drawing drag, so middle-drag is how you pan while it is on. Zones also stop being clickable while a placing mode is active, so a zone over a corner of the map does not block placing there.

### Move, turn and delete

Click a thing to select it, then **drag it to move it**. Dragging one of a group's units moves the whole group, and dragging a base's building moves it within the base. Dragging a zone moves it, and dragging its handles resizes it.

Rotation is the **Turn** button in the selection bar, which turns a quarter turn at a time. A unit faces one of four ways and nothing in between, which is what the engine gives a placed unit. A group's units all face south and cannot be turned individually.

The selection bar also has **Delete**, and says what is selected.

There is no Save button and no undo. Every change is written to disk as you make it. Text fields commit when you leave them or press Enter, sliders when you let go, and a drag when you release it.

## What you can place

### Actors

An actor is one named unit: the commander to defend, the base the mission is about, the character who has to survive. It has an id, a unit type, a team, a position and a facing, and its **Details** popover sets:

- **Starting health**, as a percentage of the unit's maximum.
- **Invulnerable**, for a unit the mission is not asking anyone to kill.
- **Unselectable**, for a unit the player should not be ordering about.
- **Display name**, drawn over the unit in game. This is the one piece of actor state with no engine call behind it, so the name comes from coilbox's own panel rather than from the unit.

Triggers refer to actors by id, and so do orders. That is what `unit_dead`, `unit_health_below` and `unit_captured` are asking about.

### Groups

A group is a block of units spawned and ordered as one: a raiding party, a reinforcement wave, a garrison. You say what is in it (counts per unit type), where it lands, what its orders are, and whether it is there from the start.

A group has two states, and both matter:

- **On the map or not.** A group is placed at game start unless you tick **Waits for a trigger to spawn it**, which makes it dormant.
- **Awake or asleep.** Asleep is standing on hold position: the units exist and defend themselves and do not wander off. Awake is running the group's orders.

So a dormant garrison is `spawn_group` when you want it standing there and `wake_group` when you want it moving. A reinforcement wave is `wake_group` on its own, which spawns it and sends it off in one action.

Orders are one queue given to every unit in the group. **Move along**, **Patrol** and **Fight along** take a list of waypoints you draw by clicking on the map. **Guard** and **Attack** take an actor, a base's building or another group as the target. A patrol closes its loop back to where the group is standing, exactly as it would if a player had shift-clicked the same points.

### Bases

A base, a prefab in the format, is a group of buildings you drag around as one piece. The buildings are stored as offsets from the base's origin, so moving the origin moves the lot.

Each building carries its own facing. A factory also carries the **Queue** it starts with and whether it builds that queue **over and over**. The picker is limited to the game's static units, because a mobile unit inside a base would be placed off the build grid.

Every building you place can be named by a trigger, the same way an actor can. It appears in the actor picker as "Base 1's corlab", so "when the keep's factory dies" is a **unit dead** condition on that building. A scenario that names one needs mission runtime 2, which is what stops a game with an older runtime playing it with that trigger dead.

### Zones

A zone is a named area: a box with two corners or a circle with a centre and a radius. Both are flat. A scenario carries no heights anywhere, because everything in one sits on terrain, so a zone is a footprint and a unit is in it or is not whatever its altitude.

The **name** is what triggers refer to, so it is the only thing worth editing after you have drawn one. Membership is the engine's own spatial query, so a zone contains what everything else in the game would say it contains, including units nobody can see.

### Per-team settings

Each participant can be given a starting bank, free income per second, a list of units to spawn on its start position, and **no commander**. Resources are set for every team the scenario declares, so a team you say nothing about starts with nothing rather than with the game's usual opening bank. The commander is only suppressed for a team you actually mark **no commander**, because the format has a flag per team and a flat rule would make it meaningless.

## Triggers

A trigger is "when these conditions hold, run these actions". The list is flat, and triggers that enable and disable other triggers are what turn a flat list into a state machine.

Each trigger has:

- **Armed at the start**, off for a trigger something else has to enable.
- **Fires every time**, off for a trigger that fires once and disarms itself. Enabling it again re-arms it.
- **Waits N seconds between firings**, for a repeating trigger. With no wait, a repeating trigger fires on every pass its conditions hold, which on the polled tick is about twice a second.
- **Fires when**, a list of conditions with **all of these hold** or **any of these hold** over it. There is no nesting. An empty list holds under `all` and never holds under `any`.
- **Then**, the actions, run in the order you list them.

A trigger's name is its id. Renaming one rewrites the actions that referred to it.

Conditions are checked two ways, and you do not choose which. A condition about a thing that happened, a unit dying or being captured, is checked when it happens. A condition about an aggregate, a count or a zone's contents or a clock, is checked on a slow tick every 15 frames. A trigger with one aggregate condition is checked on the tick.

### Conditions

The names below are the ones in the compiled mission. The editor shows them with the underscores taken out and the first letter capitalised, so `units_in_zone` reads as **Units in zone**.

| Type | What it asks |
| --- | --- |
| `units_in_zone` | How many units are in a zone, optionally one team's and optionally only certain unit types. Holds when the count is between `min` and `max`. Neither number means at least one. `max = 0` is how you ask whether a zone is clear. |
| `unit_count` | How many units a team has, optionally only certain unit types, between `min` and `max`. |
| `unit_dead` | An actor has died. |
| `unit_health_below` | An actor's health is under a fraction of its maximum. |
| `unit_built` | A team has finished building this many of a unit type. |
| `unit_captured` | An actor has changed hands, optionally to a named team. |
| `time_elapsed` | This many seconds since the mission started. |
| `var` | A variable compared against a number, or against another variable, with `eq`, `ne`, `lt`, `lte`, `gt` or `gte`. |
| `zone_held_for` | A team has had a unit in a zone continuously for this many seconds. Leaving resets the clock. **Uncontested** asks for control instead of presence. |

`zone_held_for` is presence by default: a team standing in a zone holds it whether or not anyone else is standing there too, so one scout parked in a keep an enemy army is also sitting in satisfies "hold the keep for 60 seconds". Tick **uncontested** and anyone the holding team is not allied with breaks the hold for as long as they are in the zone, and the clock starts again from nothing when they leave.

Gaia does not contest. It owns the map's own furniture, critters and the units some maps place, which belongs to no side and fights for none, so a mission that told the player to clear the keep would otherwise be asking them to hunt down a deer. Allies do not contest either. A scenario that ticks the box needs mission runtime 3.

You cannot build this out of `units_in_zone` with `max = 0`. That reads the moment the timer runs out rather than the whole minute leading up to it.

### Actions

| Type | What it does |
| --- | --- |
| `spawn_group` | Places a group, unless it already has units standing. It does not wake one. |
| `wake_group` | Runs a group's orders, placing it first if it is not on the map. |
| `give_orders` | Replaces a group's orders and wakes it. It does not place one. |
| `gift_units` | Hands a group's units to another participant. The group keeps them, so the mission can go on ordering a squad it gave away. |
| `release_group` | Stops the mission ordering a group. The units stay on the map and stay whoever's they are. |
| `set_var` / `add_var` | Write a variable, or move one by a delta. Either takes a number or another variable. |
| `enable_trigger` / `disable_trigger` | Arm or disarm another trigger. |
| `complete_objective` / `fail_objective` | Settle an objective. The first outcome sticks. |
| `dialogue` | Say one of the scenario's declared lines. |
| `play_sound` | Play a sound by name, either an entry in the game's own `sounds.lua` or a file in the game. |
| `reveal_area` | Lift the fog over a zone for a participant, for a number of seconds or the rest of the mission. See the [limits](#what-a-scenario-cannot-do-yet). |
| `unlock_unit` | Lift the scenario's build restriction on one unit type for one participant. |
| `camera_pan` | Move the camera to a point over a number of seconds, one second by default. Optionally one participant's camera. |
| `map_marker` | Drop one of the map's own labelled points, with your label or none. Optionally on one participant's map. |
| `victory` | End the mission with the named participant's ally team as the winner. |
| `defeat` | End the mission with every other ally team as the winner. |

`gift_units` and `release_group` are separate on purpose. A mission that hands over a rescued convoy gifts it and releases it in the same trigger. One that lends an escort gifts it now and releases it when the loan ends, which one flag on the gift could not say. Releasing a group the mission still has orders for is the mission's own bug, and it is reported in the infolog rather than refused. A scenario using `release_group` needs mission runtime 3.

`camera_pan` and `map_marker` with no participant named reach everyone, which is what a single player scenario wants. Naming one is for a co-op or head-to-head mission, where yanking both players' cameras to one side's ambush shows the other player what is coming. A scenario that names one needs mission runtime 3.

`victory` and `defeat` with no participant named mean the team a human is playing. **Name one only when you mean it.** The result the campaign records comes out of the replay, and the reader asks whether the player's ally team is among the winners. A `victory` naming a participant the human is not playing therefore records a **defeat** for the player. See [Win and loss](#win-and-loss).

### What the palette greys out

The **Add a condition** and **Add an action** dropdowns list every type coilbox knows, and grey out the ones the runtime that will actually play this scenario does not implement, with the reason beside each. A type that is greyed out cannot be added, because a runtime that does not know a trigger type ignores it and plays a quietly broken mission.

Which runtime it measures against depends on the route. A game that has adopted the runtime is measured by its own vendored version. Anything else is measured by the runtime this build of coilbox ships, because that is what the test mutator carries. If the game is not installed, or the scan has not answered yet, nothing is greyed.

A type can also be greyed because there is nothing for it to point at yet. `units_in_zone` needs a zone to exist first.

### Types the game adds

The lists are not only coilbox's. A game can declare condition and action types of its own, for systems coilbox has never heard of, and those appear in the same two dropdowns under the names the game gave them, with its own one-line description and a form for its parameters. Splinter Faction's research points are the worked example: a **Grant research** action and a **Research above** condition, neither of which coilbox understands a word of.

They are never greyed out on a runtime version, because the game implements them rather than the runtime, so they work on either route.

The game writes them in `missions/extensions.lua`, and [declare your own condition and action types](mission-runtime.md#4-optional-declare-your-own-condition-and-action-types) is the format. An extension can only add the game's own concepts: anything engine-level, spawning, orders, zones, sight, restrictions, the ending, the camera, is the runtime's and a game naming one of those is refused.

## Objectives

An objective is a line of text the player is working towards, with a **Primary** or **Secondary** kind and an option to keep it **hidden until it is settled**. `complete_objective` and `fail_objective` settle one, and the first outcome sticks, so an author who wants a second chance at something writes a second objective.

Settling an objective does not end the mission. Three objectives and one ending is the ordinary case, and `victory` or `defeat` is what says it is over.

The player sees them in a panel in game: primaries first, then secondaries, in the order you listed them, with a hidden one left out until it settles.

## Dialogue and sound

A dialogue line is a radio message: a speaker, a line of text, and optionally a portrait image and a voice clip. Triggers fire them with the `dialogue` action.

**Import an image** and **Import a clip** copy the file into the scenario's own store, verbatim, with no re-encoding. Portraits take `png`, `jpg`, `jpeg`, `dds` and `bmp`, and clips take `ogg`, `wav` and `mp3`. The files travel with an export, and they are copied into the game beside the compiled mission at launch, which is how the engine can load them.

In game, lines queue rather than interrupt, because a trigger with two lines in it is an author writing an exchange. A line holds the panel for as long as its text takes to read, at least three seconds and at most twelve, and the backlog behind it is capped at six.

Dialogue lives on the scenario, not on the campaign mission, because triggers fire it while the game is running. The mission keeps only what the player sees before the engine starts.

## Restrictions

**Building** is either anything the game allows, only a list of units, or everything but a list. **Commands withheld** is a list of engine command names the mission takes away, named the way the engine names them, so self destruct is `selfd`.

**A restriction binds every team the scenario declares, not the player.** The format names no team, so binding the player alone would be a rule you never wrote, and it would leave you no way to restrict an enemy at all. `unlock_unit` is the other end of it: to make a rule that applies to the player only, write the restriction and then unlock the unit for everyone else.

Two things the runtime does not restrict: what the mission itself places, because the engine only consults the build rule for builders and factories, and a command the mission's own Lua gave, so a mission that withholds `attack` can still order its own raiders to attack.

These are not the engine's `[RESTRICT]` block, which is global and permanent. `unlock_unit` is why: a restriction lifted halfway through a mission for one participant is exactly what `[RESTRICT]` cannot express. A campaign mission's own **Restricted Units** list is still `[RESTRICT]`, and still applies to everyone. See [Campaigns](campaigns.md#unit-restrictions).

## Variables

A variable is a named number belonging to one scenario: a kill counter, a phase number, a flag saying which branch the player took. Numbers and nothing else, so `add_var` always has something to add to and the `var` condition is one comparison.

Renaming one carries the triggers that read it over. Undeclaring one leaves them alone, and they then read it as 0 and say so in the infolog.

Anywhere a `var` condition, `set_var` or `add_var` asks for a number you can name a variable instead, with the dropdown beside the box. So "kills reached the quota" is a `var` condition on `kills` reading `quota`, and "add the bonus to the score" is an `add_var` on `score` reading `bonus`. A scenario that does this needs mission runtime 3, which is what stops an older game reading the variable as nothing and comparing against zero.

## Test and play

**Test in game** is in the Setup card at the top of the editor. It compiles the scenario, writes it where the game will look for it, **reads it back out and checks every reference resolves**, and only then starts the engine. A zone name a trigger points at that no longer exists stops there rather than playing as a trigger that never fires.

If anything fails to resolve, nothing launches and every problem is listed at once, each located in editor terms, for example `Trigger "open", action 1, group`.

The drawer also says which route the launch is taking and why, before you press anything. On the mutator route it says what it is about to write and that deleting that one folder undoes it.

The button is disabled with a reason for the things you have to fix elsewhere: no engine installed, no game and map set, the game not installed, or a game already running.

**Play > Scenarios** is the player-facing half. It lists every scenario that names a game and a map, with its contents, and gives each one a **Play** button that runs the same pipeline. It also has its own **Import**, so a scenario someone sent you can be brought in and played without Advanced mode or the editor. The sidebar item is hidden until at least one scenario is ready to play.

A player is told the same facts as an author in different words. "Install it from Content" is something anyone can do, so it is said either way, while "set the scenario up on a game you have", the test mutator and mission runtime versions are the author's and are not shown on the Scenarios page at all. A player is told that coilbox sets up what the game needs and leaves their copy of it alone.

## Share a scenario

**Share** offers three ways out, the same three a preset, a challenge and a setup pack offer. **Copy code** puts a `cbz1.` code on the clipboard to paste into chat. **Copy link** wraps that code as a `coilbox://` link. **Export as file** writes a single `.json`. All three carry the same thing: a coilbox container, `"kind": "scenario"`, holding the document plus every portrait and voice clip the dialogue names, inlined as `data:` URIs beside the document.

A scenario is the one shareable thing with no upper bound on size, because those clips travel inside it. A code is capped at 512 KB of content, which no amount of authoring will reach on its own (the Silence the Jericho mission below is a 3,128 character code, and copying it out to 581 triggers still only makes an 18,000 character one), but which 380 KB of portraits and voice clips passes by itself. When a scenario is past it, Share says so and offers the file alone, rather than handing you a code that would fail on the other end. A link is capped lower still, so a scenario with any real amount of media gets a code and a file but no link.

**Import** reads any of them back, from either **Play > Scenarios** or the builder: paste a code into the box, or press **Import from file…**. It **always makes a new copy**: importing your own export gives you a second scenario with a new id, never an overwrite. Something that is not a coilbox scenario, is damaged, or was made by a newer coilbox is rejected with a reason rather than half-read. A clip an import cannot write, one over 16 MB for instance, is skipped and the line that named it loses it, rather than the whole scenario being refused.

If the scenario is played on a game or a map you do not have, import offers to download them first, the same way importing a campaign does. Nothing is written until they are both here, so cancelling leaves you with nothing to clean up.

The other way to ship one is to attach it to a campaign mission and bundle the campaign, which carries the whole scenario document. See [Campaigns](campaigns.md#missions-that-play-a-scenario).

## Ship a scenario in a distribution

A [distribution profile](distribution-profile.md) can hand out scenarios the same way it hands out campaigns. Share the scenario, choose **Export as file**, and drop the `.json` into the portable `.coilbox/scenarios/` folder beside the executable, with any name you like. Coilbox lists it alongside the player's own, marked **Bundled**.

A bundled scenario is read-only:

- It plays from **Play > Scenarios** exactly as any other scenario does. Its dialogue portraits and voice clips travel inside the export file and are written out the first time it is played, so its radio messages have their pictures and voices.
- It cannot be edited or deleted. Opening its editor route says so instead of opening the editor, and the Scenario Builder row has no Edit and no Delete.
- It can still be **Shared**. Import the code or the file back and you have a local copy that is yours to change.

Coilbox never writes into `.coilbox/`, so removing a bundled scenario means removing the file from the package. Its clips are cleaned up on the next start once it is gone.

## Play the example mission

**Silence the Jericho** is the first mission authored end to end in the Scenario Builder, and you can download it as an export: [silence-the-jericho.json](/scenarios/silence-the-jericho.json).

Importing it takes nothing but coilbox. Open **Play > Scenarios**, press **Import**, then **Import from file…** and pick it. With Advanced mode on you can do the same from **Scenario Builder > Builder** and get a scenario you can read and edit like any other.

Playing it needs the game it was written for. That machine also needs, in this order:

1. **A loose Splinter Faction**, cloned into your Spring data folder as `games/SplinterFaction.sdd`. A packaged `.sd7` or `.sdz` cannot be written into, so it cannot take the runtime. The mission names its game `SplinterFaction $VERSION`, which is the archive name a loose checkout reports. A copy reporting a different name is a different game as far as the launch is concerned.
2. **The mission runtime installed into it.** Open **Content > Games**, pick Splinter Faction, and press **Install the mission runtime**.
3. **The three adoption guards.** They are not upstream in Splinter Faction yet, so this repo keeps them as `scripts/sf-proof/splinterfaction-guards.patch`. Without them the game's own end conditions end the mission early, and its faction picker and start-spot picker run over the top of a mission that is already playing. See [running the proof yourself](mission-runtime.md#running-the-proof-yourself).
4. **The map `AcidicQuarry 5.17`** in `maps/`. A scenario's zones are map coordinates, so this mission plays on that map and no other.

With all four the mission appears under **Play > Scenarios** with a **Play** button, and **Test in game** in the editor runs the same pipeline.

The export is built from `src/scenario/fixtures/jericho.json` by `bun scripts/build-jericho-export.mjs`, and `src/scenario/example.test.ts` fails if the two ever drift apart.

## Win and loss

The runtime ends a mission by calling the engine's own game over with the winning ally teams, so the outcome lands in the replay and coilbox reads it back with the same replay detection campaigns already use. There is no separate channel.

What the reader asks is whether **the player's ally team is in the winning list**. Three consequences worth designing around:

- A `victory` naming a participant the human is not playing records a **defeat** for the player. A `victory` naming a different participant on the human's own ally team still reads as a victory, because the test is the ally team rather than the participant.
- `defeat` declares every other ally team the winner, Gaia aside, which is what a losing player's replay has to say.
- **A mission the player quits out of is recorded as a defeat**, and so is a mission the runtime ended with nobody winning. The two are indistinguishable in the replay: [issue #875](https://github.com/tomjn/coilbox/issues/875).

The manual **Victory** / **Defeat** prompt appears when the replay cannot answer at all: no new replay was found, the decode failed, or the engine's `demotool` is missing. It does not appear when the replay answered wrongly.

## What a scenario cannot do yet

Honest limits, all of them things you can hit while authoring:

- **`reveal_area` reveals a circle.** No engine call grants sight over a region, so a reveal is implemented as a short-lived invisible unit with sight. A box zone is covered by the circle around its corners, so a reveal spills past them. Under-revealing would leave the thing you drew the box around in the dark.
- **Terrain occludes a reveal.** Sight is cast from the spotter, so a ridge inside the zone shadows its far side, exactly as it would for a scout standing there. Air sight is not occluded, so aircraft over the zone are always seen.
- **The player's unit count is one too high.** The runtime keeps one invisible anchor unit on each mission team a human plays, so the engine's own "this ally team has no units" rule cannot end the mission early when the player legitimately reaches zero units. The anchor is a real unit and shows in the game's own unit count. The runtime's own counting leaves it out, so `unit_count` and `units_in_zone` are unaffected: [issue #820](https://github.com/tomjn/coilbox/issues/820).
- **A restricted unit's build icon is greyed out, and a game may un-grey it.** The runtime greys the icons your restrictions forbid, on every builder, and ungreys one an `unlock_unit` frees. A game that paints its own build icons, for a tech tree or a supply limit, can repaint over that, and then a forbidden unit looks available. The build is still refused either way.
- **A mission coilbox wrote into a game stays there.** There is no in-app way to remove one: [issue #814](https://github.com/tomjn/coilbox/issues/814).
- **A scenario cannot be set up without a preset:** [issue #821](https://github.com/tomjn/coilbox/issues/821).

One thing nobody has watched happen, so treat it as unproven rather than working:

- **The objectives panel, dialogue panel and debrief have never been drawn in a real engine.** What they decide to draw is tested outside one, but nothing has confirmed they appear, that they do not sit on top of the game's own UI, or that a portrait loads: [issue #850](https://github.com/tomjn/coilbox/issues/850).

For what the runtime does and does not do inside the engine, and how a game adopts it, see [the mission runtime](mission-runtime.md).
