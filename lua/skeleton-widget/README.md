# Coilbox skeleton widget

A Recoil engine widget that draws the skeleton of the selected units, from engine data alone. Issue https://github.com/tomjn/coilbox/issues/5179, spike in `docs/reports/2026-11-09-skeleton-widget-spike.md`.

`luaui/` is what gets installed into a content root as `LuaUI/`. `tests/` and this file are not installed.

## What the player gets

- a small Bones button at the right edge of the view, and the `coilbox_skeleton` action (bind a key, or type `/coilbox_skeleton`), to show or hide the skeleton
- for every selected unit, drawn through the model in the builder's fuchsia (`0xe879f9`): a dot at each piece's origin, a dim line from it to its parent's origin, and a brighter, wider bone from the origin to the far end of the piece's geometry. An empty piece has no geometry, so it gets a dot and its parent line and no bone
- the skeleton follows the pose every frame
- the name of the piece under the cursor, or every piece's name with the Names button or the `coilbox_skeleton_names` action
- both choices are kept in the widget's config

`WG.CoilboxSkeleton` offers `toggle`, `toggleNames` and `showing()` to a game's own interface.

## The bone end rule

`boneEnd` in `luaui/coilbox_skeleton/skeleton.lua`, from the piece's `min` and `max` box in its own space:

1. Take the axis the box is longest along (`max - min`).
2. The end is the middle of the box face on that axis that lies farther from the origin.
3. Being the middle of a face, the end keeps the box's offset on the other two axes, so a barrel mounted above its pivot gets a bone that points at the barrel.
4. Ties between axes of the same length go to the one whose far face lies farther from the origin, then z, y, x. Ties between two faces as far from the origin as each other go to the positive side.
5. A box that is a point at the origin gives no bone.

`src/lego` is to port it with the same cases (issue #5183). The cases are in `tests/skeleton_test.lua` as a box in and a point out.

## What the engine gives

- `Spring.GetUnitPieceList`, `GetUnitPieceInfo` (`parent`, `isEmpty`, `min`, `max`) and `GetUnitPieceMatrix`, in `rts/Lua/LuaSyncedRead.cpp`. Empty pieces report a `min` of 10000 and a `max` of -10000 on every axis, so `isEmpty` has to be read first.
- `GetUnitPieceMatrix` returns the piece's pose at the last sim frame, not the pose the model is drawn in. The engine draws a model part of the way from the frame before to this one. The widget does the same when it holds the frame before, and draws this frame's pose alone when the view draws slower than the sim runs.
- `GetUnitTransformMatrix` uses the unit's drawn position, so the skeleton follows the model between frames.
- A 3DO piece's box is about its own origin, as an S3O's is: `S3DOPiece::SetMinMaxExtends` takes it over the piece's own vertices (`rts/Rendering/Models/3DOParser.cpp`).

## Drawing

One vertex buffer, refilled every frame, drawn with one `DrawArrays` of triangles through one shader. Lines are strips two triangles wide, moved across themselves on screen by the vertex shader, because macOS draws `GL.LINES` one pixel wide whatever `gl.LineWidth` asks. Dots are quads the same shader spreads to a fixed size on screen and rounds. Names are `gl.Text`. In `spring-headless` there are no buffers, so the widget logs that once and draws nothing.

## Splinter Faction and user widgets

Splinter Faction loads widgets from a data folder only when its `allowuserwidgets` mod option is on, and it is off by default (`LuaUI/widgets_custom.lua` and `ModOptions.lua` in 0.1.96). A player turns it on under Interface Options in the lobby's mod options, and a start script sets `allowuserwidgets=1` in `[modoptions]`. Without it the infolog says `Skipping N user widget file(s)` and the widget never loads. The engine's `LuaAutoEnableUserWidgets`, 1 by default, then decides whether a new user widget starts enabled.

## Tests

```
scripts/mission-tests.sh
luajit lua/skeleton-widget/tests/skeleton_test.lua
```

They cover the bone end on each axis and every tie, an empty piece giving a joint and no bone, the tree built from a fake piece map, the pose and the blend between frames, and nothing drawn with no selection. Drawing needs a windowed engine, which CI does not have.
