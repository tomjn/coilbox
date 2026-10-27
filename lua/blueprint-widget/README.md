# Coilbox blueprint widget

A Recoil engine widget that places base blueprints from your coilbox library and saves the buildings you have selected as a new one. Issue https://github.com/tomjn/coilbox/issues/1419, design in `docs/superpowers/specs/2026-08-23-in-game-blueprint-widget-design.md`.

Coilbox installs `luaui/` into the content root as `LuaUI/` when you press the button on the blueprint library page. It never installs or updates it on its own. `tests/` and this file are not installed.

## What the player gets

- a panel, opened from a small Blueprints button or with the `coilbox_blueprints` action (bind a key, or type `/coilbox_blueprints` in the console), listing the blueprints for the game being played
- the button and the panel's title drag the panel anywhere on screen, snapping to an edge near one. Once, when the game's panels are up, which is the first time a unit is selected or five seconds after the team's first unit appears, it asks RmlUi which element is drawn at points over the panel, and every other widget's `IsAbove`, and slides up or down to the nearest place nothing answers for. Splinter Faction's panels are RmlUi documents and answer only the first. That needs the handler itself, so `GetInfo` sets `handler = true` and actions go through `widgetHandler.actionHandler`. Panels the engine draws answer to nothing and are not avoided, and the widget's config keeps where it was left and whether it shows a list or a grid
- each blueprint's layout drawn from above, with energy yellow, builders green and weapons red
- three tabs: what the selected builders can build now, what they can build in part, and everything, a page at a time, turned with the arrows in the footer or the mouse wheel
- pick a row or a tile and the layout follows the cursor as ghosts over marks in the same colours, striped with a dashed red rim where the ground refuses a building
- while it is placed, a second panel beside the first shows its cost and build time with the selected builders, and buttons for each key
- the cursor holds the building nearest the middle of the layout, and turns and flips go round it. A layout with an extractor or a geothermal is held by that instead, and within 90 elmos of a spot for it the layout jumps so it sits on the spot. Geothermal spots are the map's geothermal features. Metal spots come from whichever list the game publishes: `WG.metalSpots`, `WG.resource_spot_finder.metalSpotsList`, or Splinter Faction's `WG.metalMakerSpots` and `WG.mapmetalspots`. For any other game they come from the map's metal: each patch of touching metal squares no wider than one extractor covers, twice its `extractRange` or its footprint. The scan for patches starts when the widget loads, a row's worth of squares a frame, and finishes at once if a layout needs it sooner. `[` and `]` turn it, F and G flip it side to side and top to bottom as in Factorio before 2.0, Shift+`[` and Shift+`]` step to the previous or next blueprint, left click places it, right click or escape puts it down
- a drag lays copies in a line, each touching the last, along whichever of x and z the drag covers more, placed on release
- a building reaching past the map's edge is refused like one the ground refuses
- a layout with buildings the team can never build is for another side: it stays under All, says how many, and cannot be picked up. What a team can build is everything its units build, what those build, and what any of them morph into, read from `gamedata/morph_defs.lua` or `LuaRules/Configs/morph_defs.lua` and the `morphto` and `evolution_target` custom params
- a building the team only gets by morphing is ordered as the first def back along the morph chain that the team can build, such as a tech 1 factory for a tech 2 one, and the row says how many are left to upgrade
- what nobody selected can build stays on the map as a plan, drawn as ghosts. Pointing at a plan with builders selected outlines the building under the cursor in white, crosses it out if they cannot build it and sets the build cursor to match. A right click builds that building, a shift right click builds the whole plan after the builders' current orders, and a right click with nothing selected removes the plan
- builders either help each other, each taking every building it can build, or split up, each building going to the nearest builder until it has its share of the build time. Splitting is for games such as Splinter Faction that stop a second builder joining a nanoframe, where the stopped builder loses its whole queue. The choice is kept per game
- a layout's terrain changes are previewed while it is placed and in its plans, in the look of Zero-K's own terraform preview and Helwor's DrawTerra2 widget (`terrain.lua`, with attribution there). Each step is a see-through prism from the ground up or down to the height it will leave, green for raised ground and red for dug, with a wire grid every 16 elmos on its top and straight sides and a cyan grid on the ground under it, and a small white label with the change in elmos. Raised ground is drawn with the depth test on and depth writes off so it never hides a unit. A step is drawn the way the gadget picks the corners it sets, but not the slopes it adds round it, which are issue #4797's. It is built through the same vertex buffer path as the footprint marks, with a `ground` uniform of 2 in the shader for plain vertex colours and `GL.LINES` for the wire. A layout of steps alone is held by the middle of its steps
- a layout's terrain changes are placed in Zero-K. For each step the widget sends Zero-K's terraform order (`CMD_TERRAFORM_INTERNAL`, 39801), which is never queued, and queues a level command (`CMD_LEVEL`, 39736) with the same tag among the builders' build orders at the step's place. The level command is what puts a builder to work on the terraform units. The first command of a builder's queue replaces it unless shift is held, and the rest append. Tags come from `WG.Terraform_GetNextTag`, and from a counter of the widget's own starting at 1000000 when that function is missing. Level heights and ramp ends are added to the ground under the pivot when the player clicks. Zero-K removes terraform units nobody has worked on for two minutes, so a terraform order goes out only once at most one building is left ahead of its level command in some builder's queue (`pending_terraform.lua`, issue #4803). An order whose level command has left every queue is dropped unsent. Terraform is available in a match when a selected builder has a command described as `levelground` with that number, and otherwise when any of the team's builders does. When it is not available, or the Terrain choice is off, only the buildings are ordered and the message counts the steps skipped. A layout of steps alone is held by its origin and cannot be picked up then. Findings in issue #4789
- the panel counts what the plans hold, and offers to build them all with whatever is selected, or to dismiss them
- Save selection writes the selected buildings to a spool file that coilbox collects into the library next time it runs, with the ground changed under and round them as raise steps (issue #4798)
- Save ground waits for a rectangle dragged on the map and writes the ground changed inside it as raise steps, with no buildings

BAR's own `LuaUI/Config/blueprints.json` is read too, so a BAR player sees the layouts they already have. It is never written.

## Files

| Path | Who writes it | Where |
|---|---|---|
| `LuaUI/Config/coilbox_blueprints.json` | coilbox | content root |
| `LuaUI/Config/coilbox_blueprints_spool.json` | the widget | the engine folder, which is the write dir |
| `LuaUI/Config/blueprints.json` | BAR | wherever BAR put it |

The spool has its own name so it cannot shadow the library file in the engine's raw search order.

## Layout

```
luaui/widgets/coilbox_blueprints.lua      the engine half: callins, input, drawing
luaui/coilbox_blueprints/json.lua         the JSON codec, since the engine ships none
luaui/coilbox_blueprints/store.lua        the three files, polling, the spool write
luaui/coilbox_blueprints/model.lua        tabs, game filter, layout, vertex packing
luaui/coilbox_blueprints/place.lua        turning, snapping, blocked marks, orders
luaui/coilbox_blueprints/terrain.lua      the preview mesh of a layout's terrain steps
luaui/coilbox_blueprints/record.lua       the selection, or the ground in a rectangle, as a spool entry
luaui/coilbox_blueprints/ground.lua       ground changes read back as raise steps, without their slopes
luaui/coilbox_blueprints/pending_terraform.lua  Zero-K terraform orders held until a builder nears its step
tests/                                    luajit suites
```

Every module under `coilbox_blueprints/` takes the engine tables it reads as arguments through a `use()` call, so the tests hand it a stub. The widget file is the only one that touches `gl`, and it is the only one the tests cannot run.

## Drawing

No immediate mode. The panel's rectangles, each with its size, corner radius and border, go into one vertex buffer through `gl.GetVBO` and `gl.GetVAO`, drawn with one `DrawElements`, re-uploaded only when the layout changes. Build pictures are one textured quad each through the same shader. The fragment shader rounds the corners from that shape, and a border keeps only the outline. Text is `gl.Text`, which the engine batches. Ghosts are `gl.UnitShape`. Footprint marks on the ground are a second buffer, refilled when the snapped anchor or rotation changes. Each mark is a grid with a vertex on every heightmap point, at the ground's height, split along the engine's own diagonal, and drawn without the depth test because the terrain the engine draws is simplified with distance. The same shader rounds the marks, with a `ground` uniform that adds the rim and the stripes.

Text is placed by the middle of its capitals and drawn from the baseline, using the height of "H" from `gl.GetTextHeight`, so a label sits in the middle of its button whatever letters it has.

The panel is laid out at sizes for a view 1080 pixels tall and scales with the view's height.

The shader is `#version 130` with `GL_ARB_explicit_attrib_location`, the lowest floor that lets `VBO:Define` attribute ids match `layout(location)`.

## Other widgets and games

`WG.CoilboxBlueprints` offers `open`, `close`, `toggle`, `list`, `place(key)`, `save`, `saveGround(x0, z0, x1, z1)` in elmos, `rotate(turns)`, `flip(axis)` with `"x"` or `"z"`, `step(direction)`, `assist(mode)` with `"help"` or `"split"`, `terrain(on)` with a boolean `placeAt(x, z, shift)`, which places the blueprint being held at a point as a click there would, and `holdAt(x, z)`, which holds it at a point without the cursor, to a game's own interface.

Widget actions: `coilbox_blueprints`, `coilbox_blueprints_save`, `coilbox_blueprints_save_ground`, `coilbox_blueprints_rotate_left`, `coilbox_blueprints_rotate_right`, `coilbox_blueprints_prev`, `coilbox_blueprints_next`, `coilbox_blueprints_flip_x`, `coilbox_blueprints_flip_z`.

When the widget loads it binds `[`, `]`, `Shift+[`, `Shift+]`, `f` and `g` to the turn, step and flip actions, each only if nothing is bound to that action yet, and unbinds them when it shuts down. A key in `uikeys.txt`, or a `bind` typed in the console, replaces the default. The engine binds `[` and `]` to `buildfacing` and `f` and `g` to `fight` and `guard`. H and V, Factorio 2.0's flip keys, are not the defaults because Splinter Faction's share menu unbinds everything on H when it loads and takes H itself. LuaUI is offered a key's actions before the engine runs them, and the turn and flip actions take the key only while there is something to turn, the step actions only while the panel is open, so the rest of the time the key does its usual job. The placing panel labels its buttons with whichever keys are bound. Some widget handlers never run a widget action from a key: Splinter Faction's calls `actionHandler:KeyAction` without the key's bound actions, so the stock handler gives up and the engine runs the key's first engine action. The widget's `KeyPress` looks up the key's bindings itself and runs its own actions, which covers those handlers. A handler that does route the key has run the action and stopped the key already.

## Tests

```
scripts/mission-tests.sh
luajit lua/blueprint-widget/tests/place_test.lua
```

The suites run under LuaJIT, whose numbers are 64 bit doubles. The engine's Lua numbers are 32 bit floats, exact for integers only up to 2^24, so a test cannot see code that builds a large number, such as a key from both coordinates of a grid corner (the cause of a broken terrain preview in issue #4796). Keep keys as strings and run anything new that does arithmetic on big numbers in a real engine.

The script runs every suite under `lua/*/tests/`, and CI runs the same script. There is no engine harness for the widget itself: it needs a window, and `spring-headless` has no `gl`.

`scripts/zerok-terraform-headless.sh` plays a scripted Zero-K match in `spring-headless` with the scratch game in `tests/zerok/`. Its widget gives the orders the blueprint widget will give for terrain changes, a raised wall and then a turret on it, in ten ways. Four more cases give a blueprint's wall and turret to the widget's own `place.lua`, which the script copies in beside the probe, with and without shift, with Together and Split up, and a wall with no buildings. Two more put three Stingers, over four minutes of work, ahead of the wall, one of them for a builder Zero-K v1.14.10.3's gadget has stopped checking because two other constructors died (issue #4803). The script checks where the turrets went up, what the builders' queues held and the ground across each wall. It needs Zero-K and an engine installed, so CI does not run it. Issue #4789 has what it found. It then plays two more matches for saving the ground: one terraforms a wall with turrets, a pad and a trench and saves them with `record.lua` and `ground.lua`, and the next places the saved selection on fresh ground and saves it again. `tests/zerok/ground_check.lua` checks both and prints the changes in height the first left, which is where `ground.lua`'s tolerance comes from. `COILBOX_ZK_ONLY=ground` plays only those two.

Zero-K's widget handler loads a widget from the content root only once its `LuaUI/Config/ZK_data.lua` has a `Local Widgets Config` entry, which Zero-K writes when the game closes. So the widget does not load in the first Zero-K match played from a data folder, and does from the second.

## Handler coverage

The engine's stock widget handler scans every raw data dir (`cont/LuaUI/widgets.lua`, `VFS.DirList(WIDGET_DIRNAME, "*.lua", VFS.RAW_ONLY)`), and a content root install was confirmed live on 2026-08-23: Splinter Faction and Metal Factions, both on the stock handler, found and enabled the widget from `<content root>/LuaUI/Widgets/`. BAR's own handler has still not been checked. If a game's handler does not scan the raw dirs, the widget has to be installed into each engine folder instead.
