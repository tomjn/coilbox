# The mission runtime

The runtime is the Lua that plays a coilbox [scenario](scenarios.md) inside the engine. It is coilbox-authored and game-agnostic, and a game **vendors a copy**: coilbox writes the files into a loose `.sdd` game folder and updates them from there.

This page is for two readers. The first half is the adoption contract, for anyone maintaining a game deciding whether to take it. The second half is the architecture, for anyone working on coilbox.

For authoring, see [Scenarios](scenarios.md).

## What adopting costs

- **Three folders of Lua**, all of it named `coilbox_*` so you can see at a glance what came from here.
- **One guard** in whatever your game calls `Spring.GameOver()` from.
- **One guard** in whatever your game starts a team with. Two, if starting a team is a sequence of pre-game phases rather than a call.
- **Nothing in a normal game.** Without the `coilbox_mission` modoption the gadget's chunk returns `false` before it defines a callin or reads a file, so the gadget handler drops it. The cost of the runtime in an ordinary match is reading one file at load.
- **One unit per human-played team in a mission.** The runtime places an invisible anchor so the engine cannot end the mission early. It shows in that team's unit count and nowhere else ([issue #820](https://github.com/tomjn/coilbox/issues/820)).
- **Nothing for your own systems, unless you want them.** [Declaring condition and action types of your own](#4-optional-declare-your-own-condition-and-action-types) is two files and no coilbox release, and a game that declares none loses nothing.

A game that has not adopted the runtime is not shut out of scenarios. It just cannot play them itself, and everything goes through coilbox's test mutator instead, which is a development route and never a distribution one.

## The adoption contract

### 1. Vendor the runtime

Take `luarules/`, `luaui/` and `missions/`, and nothing else. In practice you do not copy them by hand: open **Content > Games**, pick your game, and use the **Mission runtime** section. That writes:

```
<yourgame>.sdd/
  luarules/
    gadgets/coilbox_mission_runtime.lua
    mission_runtime/coilbox_*.lua
  luaui/
    widgets/coilbox_mission_ui.lua
    mission_ui/coilbox_panel_model.lua
  missions/
    runtime.lua
```

The button reads **Install the mission runtime**, **Update the mission runtime**, **Reinstall the mission runtime** or **Replace with coilbox's mission runtime**, depending on what it found. Underneath it, coilbox says which version your game vendors, which version it ships, and which condition and action types each supports.

Only `.sdd` games can be installed into. A packaged `.sd7` or `.sdz` cannot be written into at all, so coilbox offers the test mutator there and says why.

An update removes stale runtime files, and only those. A file is coilbox's to remove if it sits under `luarules/mission_runtime/` or its name starts with `coilbox_`, and the new runtime did not just write it. Your own gadgets and any compiled `missions/<id>/mission.lua` are never touched. The path comparison is case-insensitive, so a game that spells the folder `LuaRules/Gadgets/` survives.

Coilbox never reports what it meant to write. After installing it evaluates `missions/runtime.lua` back out of the folder, through the same sandboxed Spring Lua reader the rest of the app uses, and shows you what that file actually says.

The tests under `lua/mission-runtime/tests/` are deliberately outside the three vendored folders, and are never installed.

### 2. Guard your game over

The runtime decides when a mission ends. Add one guard to whatever calls `Spring.GameOver()` in your game, so your own end conditions do not end a mission that has not finished:

```lua
if not (GG.CoilboxMission and GG.CoilboxMission.id) then
    Spring.GameOver(winners)
end
```

`GG.CoilboxMission` exists only when the runtime loaded a mission, which only happens when the `coilbox_mission` modoption is set. In a normal game the guard is one nil check.

Read it at the moment you would end the game rather than caching it at load. The runtime's gadget sits at `layer = 1000`, so it initialises after yours and the table is not there yet while your own `Initialize` runs.

This has now been through a real game's end conditions, on Splinter Faction ([issue #772](https://github.com/tomjn/coilbox/issues/772)). It is one line in one file, because Splinter Faction aliases the engine call once and both of its endings go through the alias. `LuaRules/Gadgets/game_end.lua` line 69 reads:

```lua
local GameOver = Spring.GameOver
```

and becomes:

```lua
local spGameOver = Spring.GameOver
local function GameOver(winners)
    if GG.CoilboxMission then return end
    spGameOver(winners)
end
```

That covers both call sites, the last ally team standing at line 322 and the everyone-left case at line 465, and nothing else in the game calls `Spring.GameOver` at all. This guard and the two below are not in Splinter Faction upstream. They live here as `scripts/sf-proof/splinterfaction-guards.patch`, which is what [the adoption proof](#running-the-proof-yourself) applies and what a maintainer would be sent. The snippets on this page are the shape of each change. The patch is the change itself, comments and all. Look for the alias before you go patching call sites: a game that reads `Spring.GameOver` into a local is the common shape, and the local is the cheaper place to guard.

Without it a mission ends when your game says so. In the proof the player wiped the enemy out 700 frames before the mission's own timer, and Splinter Faction's `game_end` declared the win: `Spring.IsGameOver()=true coilbox_mission_over=0`. With the guard the same run reads `Spring.IsGameOver()=false` and the mission ends itself.

The engine also ends a game itself when an ally team has nothing left, and that is not something you can guard. The runtime handles it with the anchor unit instead, and that half holds whether or not you have added your guard, because being demoted to spectator mid-mission is the damage even when nobody declares a winner.

### 3. Do not start a team the mission has already started

A scenario says which of its teams it places the opening units for. Ask before your own start gadget spawns, and spawn nothing when the answer is true:

```lua
if not (GG.CoilboxMission and GG.CoilboxMission.suppressesStart(teamID)) then
    SpawnStartUnit(teamID)
end
```

Called where you would spawn, once per team. The answer is the scenario's, so it holds for the whole mission rather than for a window, and you get the same answer whatever frame you ask on.

The runtime cannot do this for you. The engine offers no veto on `Spring.CreateUnit`: `AllowUnitCreation` is consulted for builders and factories only, never for the call a start gadget makes. So all the runtime can do by itself is destroy what your game just made, and destroying a real commander is worse than never spawning one. Splinter Faction's `LuaRules/Gadgets/game_team_com_ends.lua` line 66 answers an ally team's last commander dying with `Spring.KillTeam(teamID)`, which takes the player's own units and their seat in the game with it ([issue #884](https://github.com/tomjn/coilbox/issues/884)).

It removes an unasked-for start anyway, from load until the end of game frame 1, so a game that has not added the guard and spawns at frame 0 still works. Treat that as a fallback and nothing more. It is ahead of the commander bookkeeping only because it is that early, and no frame number is reliably ahead of a rule the runtime cannot see.

#### If your start is a sequence of phases

A game that picks a faction, or asks the player where to land, before it spawns has a second guard to add. A mission chose both before the game loaded, so those phases have nothing left to ask, and running them anyway leaves a picker sitting over the first minute of a mission that is already playing ([issue #888](https://github.com/tomjn/coilbox/issues/888)).

Skip the sequence outright:

```lua
if GG.CoilboxMission and GG.CoilboxMission.suppressesEveryStart() then
    -- go straight to whatever "the pre-game is over" is in your game
end
```

`suppressesEveryStart()` is the same question asked about the game rather than about one team: true when the mission owns the start of every non-Gaia team in it. A pre-game phase is global, so it is the whole game that decides whether one is worth running. A game with a team the mission says nothing about gets `false`, because that team still has a start to decide.

This is yours to skip rather than the runtime's to stop. A phase machine is your gadget's own state and your own rules params, and the runtime can reach neither. What it can do is answer the question, and `GG.CoilboxMission` is on the table from the moment the runtime initialises, which is before any gadget's `GameStart`.

On Splinter Faction the sequence is a faction-choice phase with a 900-frame deadline and then a start-spot placement phase with another, so its start units land on frame 1800. `LuaRules/Gadgets/game_spawn.lua` takes both guards: the spawn one at the top of `SpawnStartUnit`, and the phase one at the top of `gadget:GameStart`, after the teams are collected and before it loads the map's start spots.

```lua
if GG.CoilboxMission and GG.CoilboxMission.suppressesEveryStart() then
    phase = "done"
    Spring.SetGameRulesParam("phase", "done")
    return
end
```

`phase` is that game's own rules param, and both its pickers read it: each removes itself as soon as the phase is not its own. Writing `done` is also how the rest of the game learns the match is running, so its research ledger and its survival AI start at frame 0 instead of at 1800.

`scripts/mission-sf-proof.sh` reads that param back out. With both guards the phase is `done` at frame 2 and the game never loaded a start spot. Without the second one it reads `faction` at frame 2 and `placement` at frame 1000.

### 4. Optional: declare your own condition and action types

Your game has systems coilbox has never heard of. Splinter Faction has research points, a weather model and a faction chooser, and none of them mean anything to a generic runtime. Declare trigger types for them and a mission author can use them the way they use `unit_dead`, with a form for the parameters and no coilbox release in between ([issue #776](https://github.com/tomjn/coilbox/issues/776)).

Two files, both yours:

```
<yourgame>.sdd/
  missions/extensions.lua                    what the types are called and what they take
  luarules/mission_extensions/<yours>.lua     what they do
```

Neither is coilbox's to overwrite. Keep them out of `luarules/mission_runtime/` and do not name them `coilbox_*`, because those are the two things a runtime update deletes when it stops shipping a file.

#### The declaration

Data only, no globals and no engine calls, exactly like `missions/runtime.lua` beside it. It is read twice: by the runtime at load, and by coilbox's editor to build its palette.

```lua
return {
  -- The code below, by VFS path.
  handler = "luarules/mission_extensions/research.lua",

  conditions = {
    {
      type = "sf_research_above",
      label = "Research above",
      description = "The team's research points have passed this number",
      params = {
        { name = "team", kind = "teamId" },
        { name = "amount", kind = "number" },
      },
    },
  },

  actions = {
    {
      type = "sf_grant_research",
      label = "Grant research",
      description = "Pay research points into a team's ledger",
      params = {
        { name = "team", kind = "teamId" },
        { name = "amount", kind = "number" },
      },
    },
  },
}
```

- `type` is the name a trigger stores and the runtime dispatches on. Prefix it with something of your own, the way both of these do, so it cannot collide with a type a later coilbox adds.
- `label` is what the palette calls it, and `description` is the line under it. Both are optional. A type with no label is read off its name, so `sf_weather` shows as "Sf weather".
- `params` is a list rather than a table, because it is drawn in the order you write it.

A parameter's `kind` is one of:

| kind | the field the author gets |
| --- | --- |
| `string` | a text box |
| `number` | a number box |
| `boolean` | a switch |
| `strings` | a list of typed values |
| `point` | a place clicked on the map |
| `orders` | the order editor a group's own orders use |
| `enum` | a dropdown over your `values = { ... }` |
| `zoneId` `actorId` `groupId` `triggerId` `objectiveId` `dialogueId` `teamId` `varName` | a dropdown over the scenario's own zones, actors, groups, triggers, objectives, dialogue lines, teams or variables |

Add `optional = true` for a parameter an author may leave out. Your code then gets `nil` and applies its own default.

The id kinds are the ones worth reaching for. A `zoneId` parameter is picked from the zones the scenario has, so it cannot name one that does not exist, and it follows a rename. Anything a parameter of an id kind holds is checked at compile time before the mission is launched.

#### The handler

Code, so the runtime runs it in an environment that reaches the engine and `GG`. It returns implementations keyed by type name:

```lua
return {
  conditions = {
    sf_research_above = {
      -- The events this reacts to. Leave it out and it is evaluated on the
      -- polled tick, twice a second, which is what an aggregate wants.
      -- events = { "unit_destroyed" },
      test = function(params, ctx)
        local team = ctx.teamOf(params.team)
        return team ~= nil and GG.Research.Get(team) > (tonumber(params.amount) or 0)
      end,
    },
  },

  actions = {
    sf_grant_research = function(params, ctx)
      local team = ctx.teamOf(params.team)
      if team then
        GG.Research.Add(team, tonumber(params.amount) or 0, "mission")
      end
    end,
  },
}
```

`params` is what the author filled in, verbatim. `ctx` is shared with the rest of the runtime and carries:

- `ctx.teamOf(name)`, the engine team number for a team the scenario names. Trigger parameters carry the author's team names, so a `teamId` parameter goes through here before the engine sees it.
- `ctx.state`, which is `GG.CoilboxMission`: the mission, its actors and their units, its zones, vars, groups and objectives, and the handles that drive them. `lua/mission-runtime/README.md` documents every one.
- `ctx.engine`, the trigger engine. `ctx.engine:event(name, payload)` raises an event of your own, which a condition of yours can then declare in its `events`.
- `ctx.frame`, the game frame, and `ctx.event` when this pass came from an event.

Your globals stay yours: the handler runs in a table of its own that falls through to the gadget's environment, so it can read `GG` and call `Spring`, and anything it sets does not land in the runtime.

#### The boundary

**An extension adds a game concept, never an engine one.** Everything engine-level, spawns, orders, zones, sight, restrictions, game over, camera, markers and rules params, stays in the generic runtime.

That is enforced rather than asked for. A declaration naming a type `missions/runtime.lua` declares is refused with an error in the infolog, whichever of the two lists it is in, and the runtime's own version is what the mission runs. The editor refuses the same names and says so above the trigger list.

Two smaller rules follow from the same idea, that what runs is what an author can edit:

- The handler may only implement types the declaration lists. One it implements and the declaration does not is reported and not registered.
- A type the declaration lists and the handler does not implement is reported. The condition never holds and the action does nothing, which is what any unimplemented type does.

#### What the author sees

Your types are in the two pickers with the rest, labelled and described as you wrote them, and their parameters are edited by the same fields a built-in type's are. They are never greyed out on a runtime version, because you implement them: they run on whichever route the scenario takes, since coilbox's test mutator is stacked on your game and reads your declaration through it.

Coilbox reads the declaration out of a loose `.sdd` only, through the same sandboxed Lua the version marker goes through. A packaged `.sd7` or `.sdz` runs its extensions fine and cannot have them read by the editor, which is the same limit that applies to the version marker.

A declaration coilbox cannot make sense of costs you only the part that is wrong. A type whose parameter names a `kind` this coilbox has no field for is dropped, with the reason shown above the trigger list, and the rest of the file is offered as usual.

## How the game knows it is a mission

One modoption, written by coilbox into the start script it already generates:

```
coilbox_mission = <scenario id>
```

The gadget reads `Spring.GetModOptions().coilbox_mission`, trims it, and refuses anything that is not a plain name, because the id becomes part of a VFS path. With a valid id it includes `missions/runtime.lua` and `missions/<id>/mission.lua`, refuses a mission needing a newer runtime than it is, and publishes both on `GG.CoilboxMission` for the rest of the runtime and for your own Lua.

`mission` on that table is the compiled scenario exactly as coilbox emitted it, so a misbehaving mission can be diagnosed by reading `missions/<id>/mission.lua` beside the scenario in coilbox.

The gadget sits at `layer = 1000`, behind your own gadgets, because it is overriding the game rather than pre-empting it. It wants the last word on starting resources.

## What the runtime takes over

Enough to be worth knowing before you adopt it:

- **The start.** Every actor, prefab building, per-team start unit and non-dormant group is created at game start. A building is put through `Spring.Pos2BuildPos` on the way, so it sits on the build grid and can be rebuilt where it stood.
- **Starting resources, for every mission team.** At game frame 1 each team the scenario declares has its bank set to the scenario's number, defaulting to nothing. That is how the game's usual opening bank is suppressed. Free income, if the scenario asks for it, is paid every frame.
- **Commanders, only where asked.** A team whose scenario entry sets `noCommander` is a team the runtime starts and your game does not, which is [contract item 3](#3-do-not-start-a-team-the-mission-has-already-started). Teams without the flag keep the commander your game gave them.

  Add the guard and nothing else happens. Skip it and the runtime falls back to removing what your game spawned, from load until the end of game frame 1, touching only creations with no builder. That window is no use to a game that spawns later than frame 1: Splinter Faction spawns on frame 1800, and its commanders arrived despite `noCommander` until it took the guard ([issue #884](https://github.com/tomjn/coilbox/issues/884)).
- **Game over**, through your guard and the anchor unit.
- **`AllowUnitCreation` and `AllowCommand`, only when a mission restricts something.** Both callins are hot, and a mission that restricts nothing defines neither.

Everything else your game does carries on. The runtime does not touch your economy, your unit definitions or your own gadgets.

## The three artefacts

For coilbox contributors. The runtime is one of three pieces that have to stay in step.

1. **The runtime** lives in this repo under `lua/mission-runtime/` and ships as a Tauri resource. `lua/mission-runtime/README.md` is its own reference and documents every module in detail.
2. **The install path** is Content > Games, above. Coilbox writes the files in, reads the version marker back, and shows what the installed runtime supports.
3. **The test mutator** is a generated game, `coilbox-mission-test.sdd`, in the content root's `games/` folder. It carries a generated `modinfo.lua` depending on the base game, the runtime, and the one scenario under test. Everything else comes from the base game. The folder name is a compile-time constant in the Rust that writes it, so that code can only ever write to coilbox's own game, and deleting the folder undoes everything it ever did. It follows the same pattern as the lego builder's scratch game.

## Compile and validate

A scenario is JSON in coilbox's app data (`scenario/scenarios/<id>.json`, with dialogue media under `scenario/media/<id>/`). Playing or testing one compiles it to a Lua table literal at `missions/<id>/mission.lua`, so the runtime needs one `VFS.Include` and no parser.

The emitted file is a single `return { ... }` under a two-line header. It is deterministic: array order is document order, every author-keyed table is emitted in sorted key order, Lua keywords are bracketed so a trigger's `repeat` becomes `["repeat"]`, and a non-finite number throws rather than emitting. Two things are added at compile time that the document cannot carry: each participant's engine team number, and the game and map names.

**The compile step doubles as the validator.** After writing, coilbox reads the file back out of the game folder with `coilbox-springlua`, which evaluates loose Spring Lua against a rooted VFS, and asserts that every id reference resolves before the engine sees it: every actor, group and prefab names a team that has an engine team number, every order target names an actor or a group, and every trigger parameter of an id kind resolves against its registry. An unknown step type is skipped, because it belongs to a game extension.

The validator is the same code path the engine will take, not a second implementation that can disagree with it. A scenario that does not validate is not launched, and the reasons are shown in editor terms rather than as compiled paths.

Dialogue portraits and clips are copied into `missions/<id>/` beside the compiled file, on both routes, so the engine finds them in the same place either way.

## Version negotiation

`missions/runtime.lua` is data with no globals and no engine calls, so it evaluates identically in the engine and in coilbox's sandboxed reader. It declares:

```lua
return {
  version = 1,
  schemaVersion = 1,
  conditions = { ... },
  actions = { ... },
}
```

Coilbox reads two of these: the one in the game (`installed`) and the one this build ships (`available`). Every type is then in one of three states. `supported` means the installed runtime declares it. `added` means coilbox's does and the installed one does not, so installing or updating brings it. `extra` means the installed runtime declares it and coilbox does not, so the game is ahead of this build.

A scenario records `runtimeVersion`, the lowest runtime that can play it, computed from the trigger types it uses. It is recomputed on every save, by the one function every write goes through, so a stored document always names the runtime it actually needs. Every launch-set type is version 1, so today that number is always 1.

Two rules keep this honest, and both matter to anyone adding a type:

- **Adding a condition or action means adding it to `missions/runtime.lua` and bumping `version` in the same change.**
- **A type that has shipped is never removed.** A scenario asking for it would then silently do nothing, which is the failure the whole capability table exists to prevent.

The editor greys types the target runtime cannot run, and a game vendoring a runtime older than a scenario needs is treated as a game with no runtime at all, so it falls to the mutator rather than playing a mission with silently dead triggers.

## How the runtime is tested

Two suites, and they answer different questions.

```sh
scripts/mission-tests.sh
```

Every `tests/*_test.lua` file, each in its own `luajit`, against a stub of the slice of the engine the runtime touches. This is what CI runs, and it proves the runtime's own logic. `mission_trigger_test.lua` runs the fixtures in `src/scenario/fixtures/missions/`, which are files coilbox's own compiler emitted, so the runtime is proved against the shape it will actually get.

```sh
scripts/mission-headless.sh
```

A real engine. It builds a scratch game out of the runtime plus the compiled fixtures and plays each one in `spring-headless`, which simulates with no OpenGL context. A probe gadget stands in for the player: it walks a unit into a zone, kills an actor, hands one over, and checks what the runtime did about it. Nothing in CI runs this, because a runner has no engine, no game and no map. The script's header lists the environment variables that point it at them.

```sh
scripts/mission-sf-proof.sh
```

The adoption proof, and it runs the other way round from the two above. Both of those play a runtime the harness itself laid down, which settles the runtime's behaviour and says nothing about adoption. This one plays the runtime out of a real game: the scratch mutator carries only a probe, and depends on a loose Splinter Faction that coilbox's own **Install the mission runtime** button wrote into. It copies `src/scenario/fixtures/missions/splinter/mission.lua` to `missions/splinter/mission.lua` in that game, which is where coilbox's launch path puts a compiled mission, and removes it again unless you pass `--keep-mission`.

```sh
scripts/mission-sf-extension.sh
```

The same game again, asking whether a game's own trigger types run. It plays a mission whose action pays research points into Splinter Faction's ledger and whose condition waits on the balance, and the number it quotes is that game's own `researchPoints` rules param, which nothing in coilbox can write. The declaration and the handler are in `scripts/sf-extension/` rather than in the game, because they are the proof's rather than Splinter Faction's, and the script copies all three files in and takes them out again unless you pass `--keep`.

It also proves the boundary by running into it. The declaration names `time_elapsed` on purpose, and the mission's first trigger waits on one, so a run where an extension could redefine an engine-level type is a run where nothing happens.

```sh
scripts/mission-sf-jericho.sh
```

The same shape again, on the same game, asking the other half of the question. The adoption proof asks whether Splinter Faction can host the runtime. This plays **Silence the Jericho**, the first mission authored end to end in the Scenario Builder ([issue #773](https://github.com/tomjn/coilbox/issues/773)), and asks whether it is won: the dormant patrols spawn and wake, the trigger zones fire, the radio lines are said, and destroying the Jericho structure ends the mission with the player's ally team the winner. The mission is `src/scenario/fixtures/jericho.json` and its compiled Lua is in the corpus beside it. It needs the same setup as the proof below, plus `AcidicQuarry 5.17` in `maps/`, because a scenario's zones are map coordinates.

To play the same mission in coilbox rather than headless, import it: [Play the example mission](scenarios.md#play-the-example-mission) is the download and the setup, and the setup is the proof's.

#### Running the proof yourself

The proof needs a game that has taken both halves of the contract, and neither half is in this repo. The runtime comes from coilbox's own install button. The three guards are Splinter Faction's change to make and are not upstream yet, so this repo keeps them as a patch, `scripts/sf-proof/splinterfaction-guards.patch`. That file is the exact text of all three, and it is what a maintainer would be sent.

1. Clone [Splinter Faction](https://github.com/SplinterFaction/SplinterFaction) into your Spring data folder as `games/SplinterFaction.sdd`.
2. In coilbox, open **Content > Games**, pick Splinter Faction, and press **Install the mission runtime**.
3. Run `scripts/mission-sf-proof.sh --apply-guards`. It applies the patch, names the three guards it added and prints the command that undoes them.
4. You need `spring-headless`, and a map in `maps/`. The script's header lists the environment variables if yours are somewhere other than `~/.spring`.

Without `--apply-guards` the script checks for the guards and stops, listing what is missing and the `git apply` line that adds it. That is the default because a proof that quietly edits your game install is worse than one that refuses and tells you what to apply. Either way nothing is written into the game without saying so first, and a re-run adds nothing twice.

The patch is stored with this repo's LF line endings while Splinter Faction checks `.lua` out with CRLF, so both the script and the command it prints apply it with `--ignore-whitespace`.

**The adoption proof has found what a second game costs.** Every general claim held on a game the runtime had never seen: the gadget loaded out of the game's own `LuaRules`, read its own version marker, published the mission, placed the scenario's units, overrode the game's opening bank, kept the game's `game_end` out of the ending once the guard was in, and ended the mission itself with the right winner.

What did not hold was the start, twice over, and both are why contract item 3 exists. Splinter Faction spawns 1800 frames after the runtime stops watching, so its commanders arrived despite `noCommander` ([issue #884](https://github.com/tomjn/coilbox/issues/884)). Then, once it was spawning nothing, its faction picker and its spot picker still ran to frame 1800 over a mission that was already playing ([issue #888](https://github.com/tomjn/coilbox/issues/888)). Neither is fixable from inside the runtime, and no amount of running against Balanced Annihilation would have found either.

**The headless run has found bugs the stub could not.** `gift_units` moved nothing between teams that were not allied, and the runtime never noticed, because it asked for a share and threw the refusal away. The stub agreed with everything, so all fifteen suites passed on it. The fix was to ask for a capture instead, and to report a refusal ([issue #857](https://github.com/tomjn/coilbox/issues/857)). This is the whole argument for keeping the headless harness: a stub can only ever agree with the reading of the engine's source that was written into it.

### What is still unproven

Two claims nobody has watched happen, both because Balanced Annihilation's LuaUI does not load against a current engine, which is the game the harness runs on:

- **The mission UI widget has never been reached.** The objectives panel, the dialogue panel and the debrief are proved only as far as `coilbox_panel_model.lua`, which is pure and decides what to draw. That the drawing then lands where it should, that the panels do not sit on top of the game's own UI, and that a portrait loads, are open: [issue #850](https://github.com/tomjn/coilbox/issues/850).
- **Restrictions have never run in an engine.** `AllowUnitCreation` returning `false, true` to clear a factory queue, and `AllowCommand` withholding a command, are the two callins with no fixture behind them, because all three fixtures restrict nothing: [issue #849](https://github.com/tomjn/coilbox/issues/849).

Anything a widget does is OpenGL, a font and a mouse, and none of the three exists outside a running engine, so the widget will always need a real one to settle.

## Further reference

`lua/mission-runtime/README.md` in this repository is the runtime's own documentation, module by module: the trigger engine's arming and cascade rules, how zones are sampled, what crosses between the synced and unsynced halves, how the anchor and the reveal spotter are chosen, and every handle a game's own Lua can drive the mission through.
