# Coilbox blueprint widget

A Recoil engine widget that places base blueprints from your coilbox library and saves the buildings you have selected as a new one. Issue https://github.com/tomjn/coilbox/issues/1419, design in `docs/superpowers/specs/2026-08-23-in-game-blueprint-widget-design.md`.

Coilbox installs `luaui/` into the content root as `LuaUI/` when you press the button on the blueprint library page. It never installs or updates it on its own. `tests/` and this file are not installed.

## What the player gets

- a panel, opened from a small Blueprints button or with the `coilbox_blueprints` action (bind a key, or type `/coilbox_blueprints` in the console), listing the blueprints for the game being played
- the button and the panel's title drag the panel anywhere on screen, snapping to an edge near one, and the widget's config keeps where it was left and whether it shows a list or a grid
- each blueprint's layout drawn from above, with energy yellow, builders green and weapons red
- three tabs: what the selected builders can build now, what they can build in part, and everything, a page at a time, turned with the arrows in the footer or the mouse wheel
- pick a row or a tile and the layout follows the cursor as ghosts over marks in the same colours, striped with a dashed red rim where the ground refuses a building
- while it is placed, a second panel beside the first shows its cost and build time with the selected builders, and buttons for each key
- `[` and `]` turn it, F and G flip it side to side and top to bottom as in Factorio, Shift+`[` and Shift+`]` step to the previous or next blueprint, left click places it, right click or escape puts it down
- builders either help each other, each taking every building it can build, or split up, each building going to the nearest builder until it has its share of the build time. Splitting is for games such as Splinter Faction that stop a second builder joining a nanoframe, where the stopped builder loses its whole queue. The choice is kept per game
- a partial placement leaves what nobody selected could build as a remainder, and the panel offers to place that with whatever is selected later
- Save selection writes the selected buildings to a spool file that coilbox collects into the library next time it runs

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
luaui/coilbox_blueprints/record.lua       the selection as a spool entry
tests/                                    luajit suites
```

Every module under `coilbox_blueprints/` takes the engine tables it reads as arguments through a `use()` call, so the tests hand it a stub. The widget file is the only one that touches `gl`, and it is the only one the tests cannot run.

## Drawing

No immediate mode. The panel's rectangles, each with its size, corner radius and border, go into one vertex buffer through `gl.GetVBO` and `gl.GetVAO`, drawn with one `DrawElements`, re-uploaded only when the layout changes. Build pictures are one textured quad each through the same shader. The fragment shader rounds the corners from that shape, and a border keeps only the outline. Text is `gl.Text`, which the engine batches. Ghosts are `gl.UnitShape`. Footprint marks on the ground are a second buffer, refilled when the snapped anchor or rotation changes. Each mark is a grid with a vertex on every heightmap point, at the ground's height, split along the engine's own diagonal, and drawn without the depth test because the terrain the engine draws is simplified with distance. The same shader rounds the marks, with a `ground` uniform that adds the rim and the stripes.

Text is placed by the middle of its capitals and drawn from the baseline, using the height of "H" from `gl.GetTextHeight`, so a label sits in the middle of its button whatever letters it has.

The panel is laid out at sizes for a view 1080 pixels tall and scales with the view's height.

The shader is `#version 130` with `GL_ARB_explicit_attrib_location`, the lowest floor that lets `VBO:Define` attribute ids match `layout(location)`.

## Other widgets and games

`WG.CoilboxBlueprints` offers `open`, `close`, `toggle`, `list`, `place(key)`, `save`, `rotate(turns)`, `flip(axis)` with `"x"` or `"z"`, and `step(direction)` to a game's own interface.

Widget actions: `coilbox_blueprints`, `coilbox_blueprints_save`, `coilbox_blueprints_rotate_left`, `coilbox_blueprints_rotate_right`, `coilbox_blueprints_prev`, `coilbox_blueprints_next`, `coilbox_blueprints_flip_x`, `coilbox_blueprints_flip_z`.

When the widget loads it binds `[`, `]`, `Shift+[`, `Shift+]`, `f` and `g` to the turn, step and flip actions, each only if nothing is bound to that action yet, and unbinds them when it shuts down. A key in `uikeys.txt`, or a `bind` typed in the console, replaces the default. The engine binds the same keys to `buildfacing`, `fight` and `guard`. LuaUI is offered a key's actions before the engine runs them, and the turn and flip actions take the key only while there is something to turn, the step actions only while the panel is open, so the rest of the time the key does its usual job. The placing panel labels its buttons with whichever keys are bound. A game whose own widget handler takes `[` and `]` first, as BAR may, leaves the actions to be bound to other keys.

## Tests

```
scripts/mission-tests.sh
luajit lua/blueprint-widget/tests/place_test.lua
```

The script runs every suite under `lua/*/tests/`, and CI runs the same script. There is no engine harness: the widget needs a window, and `spring-headless` has no `gl`.

## Handler coverage

The engine's stock widget handler scans every raw data dir (`cont/LuaUI/widgets.lua`, `VFS.DirList(WIDGET_DIRNAME, "*.lua", VFS.RAW_ONLY)`), and a content root install was confirmed live on 2026-08-23: Splinter Faction and Metal Factions, both on the stock handler, found and enabled the widget from `<content root>/LuaUI/Widgets/`. BAR's own handler has still not been checked. If a game's handler does not scan the raw dirs, the widget has to be installed into each engine folder instead.
