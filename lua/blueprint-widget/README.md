# Coilbox blueprint widget

A Recoil engine widget that places base blueprints from your coilbox library and saves the buildings you have selected as a new one. Issue https://github.com/tomjn/coilbox/issues/1419, design in `docs/superpowers/specs/2026-08-23-in-game-blueprint-widget-design.md`.

Coilbox installs `luaui/` into the content root as `LuaUI/` when you press the button on the blueprint library page. It never installs or updates it on its own. `tests/` and this file are not installed.

## What the player gets

- a panel, opened with the `coilbox_blueprints` action (bind a key, or type `/coilbox_blueprints` in the console), listing the blueprints for the game being played
- three tabs: what the selected builders can build now, what they can build in part, and everything
- pick a row and the layout follows the cursor as ghosts, with the squares the ground refuses marked red
- `[` and `]` turn it, left click places it, right click or escape puts it down
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

No immediate mode. The panel's rectangles go into one vertex buffer through `gl.GetVBO` and `gl.GetVAO`, drawn with one `DrawElements`, re-uploaded only when the layout changes. Build pictures are one textured quad each through the same shader. Text is `gl.Text`, which the engine batches. Ghosts are `gl.UnitShape`. Footprint squares on the ground are a second buffer, refilled when the snapped anchor or rotation changes.

The shader is `#version 130` with `GL_ARB_explicit_attrib_location`, the lowest floor that lets `VBO:Define` attribute ids match `layout(location)`.

## Other widgets and games

`WG.CoilboxBlueprints` offers `open`, `close`, `toggle`, `list`, `place(key)`, `save` and `rotate(turns)` to a game's own interface.

Widget actions: `coilbox_blueprints`, `coilbox_blueprints_save`, `coilbox_blueprints_rotate_left`, `coilbox_blueprints_rotate_right`.

A game that binds `[` and `]` to its own actions, as BAR does for build facing, takes those keys before the widget sees them. The rotate actions are there for that case.

## Tests

```
scripts/mission-tests.sh
luajit lua/blueprint-widget/tests/place_test.lua
```

The script runs every suite under `lua/*/tests/`, and CI runs the same script. There is no engine harness: the widget needs a window, and `spring-headless` has no `gl`.

## Not yet checked

Whether a game's own widget handler scans every raw data dir or only the write dir. The engine's stock handler scans every one (`cont/LuaUI/widgets.lua`, `VFS.DirList(WIDGET_DIRNAME, "*.lua", VFS.RAW_ONLY)`). If a game's does not, the widget has to be installed into each engine folder instead.
