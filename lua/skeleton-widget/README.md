# Coilbox skeleton widget

A Recoil engine widget that draws the skeleton of the selected units, from engine data alone. Issue https://github.com/tomjn/coilbox/issues/5179, in the milestone https://github.com/tomjn/coilbox/milestone/98.

`luaui/` is what gets installed into a content root as `LuaUI/`. `tests/` and this file are not installed.

## What the player gets

- a small Bones button at the right edge of the view, and the `coilbox_skeleton` action (bind a key, or type `/coilbox_skeleton`), to show or hide the skeleton
- for every selected unit, drawn through the model in the builder's fuchsia (`0xe879f9`): a dot at each piece's origin, a dim line from it to its parent's origin, and a brighter, wider bone from the origin to the far end of the piece's geometry. An empty piece has no geometry, so it gets a dot and its parent line and no bone
- a piece whose geometry reaches both ways from its origin, such as a radar dish on a central pivot, gets one straight bone from face to face. Where the geometry sits to one side of the origin, a thin line joins the dot to the bone
- hints for telling bones apart. A bone is wide and bright at its origin, and narrow and darker at its tip. Bones turn from fuchsia towards blue as pieces get deeper in the tree. Every line has a dark edge, so it shows against any background
- a piece that is moving against its parent is paler and wider, and fades back once it stops
- with the cursor on a piece's dot, that piece and the pieces between it and the root stay in full and the rest are dimmed
- thinner lines on a unit that is small on screen, so a small or distant unit is not buried under its skeleton
- the skeleton follows the pose every frame
- the name of the piece under the cursor, or every piece's name with the Names button or the `coilbox_skeleton_names` action
- for a unit coilbox knows the body plan of, the plan's bones in full with their role label beside each, and the other pieces dimmed. The Others button, or the `coilbox_skeleton_others` action, hides the dimmed pieces
- a plan read off a model instead of made by coilbox (evidence `observed`) is drawn dashed
- all three choices are kept in the widget's config

`WG.CoilboxSkeleton` offers `toggle`, `toggleNames`, `toggleOthers`, `showing()` and `others()` to a game's own interface.

## The body plan file

Coilbox writes `LuaUI/Config/coilbox_skeletons/<Game.gameShortName>.json` into a content root. The writer is `src/lego/skeletonFile.ts`, the reader `luaui/coilbox_skeleton/plan.lua`. The writer runs when a unit with a skeleton is exported into a game folder under `<content root>/games/`, and from the Write skeletons button on this widget's row on the Widgets page, which writes every saved unit with a skeleton.

```json
{
  "version": 1,
  "units": {
    "fedcommander": {
      "evidence": "fitted",
      "pieces": { "lthigh": { "bone": "thigh.l1", "label": "Left thigh" } }
    }
  }
}
```

- A unit is matched by its unit definition's name and a piece by its name in the model, both ignoring case.
- `evidence` is `built` (coilbox made the pieces from a plan), `fitted` (a plan fitted to pieces the unit already had) or `observed` (read off a game's model, drawn dashed). A word this version does not know is drawn as `built`.
- `label` is the role's label in the language coilbox was in when it wrote the file, so the widget carries no list of roles. A bone with no role is labelled with its piece's name.
- Writing merges into the file. An `observed` entry never replaces a `built` or `fitted` one, and units and top level keys the writer was not given are kept. Keys beyond `version` and `units` belong to other writers: `coilbox_test_unit` is the unit Test in game wants selected (issue #5182), described below.
- No file, no folder, or no entry for a unit is the normal case and logs nothing. A file that is there and will not read logs one warning. A plan that names none of a unit's pieces is read as no plan, so a file written for another model dims nothing.
- The file is read once, when the widget loads. `/luaui reload` reads it again.
- JSON is read by `luaui/coilbox_skeleton/json.lua`, the decoder of the blueprint widget's `json.lua` without its encoder. Each widget stands alone, so it is a copy.

## Test in game

Test in game (`src/lego/testSkeleton.ts`) installs or updates this widget in the content root, then writes the scratch game's file, `LuaUI/Config/coilbox_skeletons/coilbox_lego_test.json`, with the unit's plan under `units` and the unit's definition name under the top level key `coilbox_test_unit`. A unit with no skeleton gets the key and no plan, and any plan an earlier test left for that name is removed. Coilbox removes the key again when the match ends, because other games, such as a campaign's, are built into folders with the same short name.

`luaui/coilbox_skeleton/testunit.lua` does the rest. Every 15 sim frames until it succeeds, the widget asks for the player's own units of that definition (`Spring.GetTeamUnitsByDefs`). The first time one exists it selects it with `Spring.SelectUnitArray`, turns the skeleton on and logs one line. It does this once per widget load, so a later deselect or Bones press is not undone. A name the game has no definition for logs one warning. A file with no key, which is every file but a Test in game launch's, gets no picker and the widget does nothing extra.

The skeleton showing because of the test is not written to the widget's config. Only a press of the Bones button, or `coilbox_skeleton`, changes what is kept.

## The bone end rule

`boneEnd` in `luaui/coilbox_skeleton/skeleton.lua`, from the piece's `min` and `max` box in its own space:

1. Take the axis the box is longest along (`max - min`).
2. The end is the middle of the box face on that axis that lies farther from the origin.
3. Being the middle of a face, the end keeps the box's offset on the other two axes, so a barrel mounted above its pivot gets a bone that points at the barrel.
4. Ties between axes of the same length go to the one whose far face lies farther from the origin, then z, y, x. Ties between two faces as far from the origin as each other go to the positive side.
5. A box that is a point at the origin gives no bone.

`boneStart` gives the other end of a piece that reaches both ways. When the box has the origin between its two faces on the bone's axis, it is the middle of the nearer face. Otherwise there is none. The widget then draws the bone from one face to the other, widest at the point of that line nearest the origin. `boneEnd` is unchanged, so the builder's copy in `src/lego/boneEnd.ts` still matches it. The builder does not draw the other end.

`src/lego/boneEnd.ts` is the same rule, and its test reads the `ends(...)` cases of `tests/skeleton_test.lua`, a box in and a point out.

## Movement

The engine has no read of a piece's pose against its parent. `GetUnitPieceMatrix` is in model space, so every piece of a walking unit changes each frame. The tracker undoes the parent's rotation to get the piece's pose as its parent sees it, and compares that between two sim frames. `TURN_TOLERANCE` and `MOVE_TOLERANCE` are how much it has to change. They were chosen from the size of 32-bit float error and have not been measured in a game.

## Tuned by eye

`FULL_AT_RADIUS`, `FOCUS_DIM`, `HOT_MIX`, `HOT_WIDTH`, `FADE_FRAMES`, `TIP_LUMA`, `DEEP_COLOR` and the shader's `SMALLEST` were set from screenshots of Beyond All Reason units. None is derived from anything.

## What the engine gives

- `Spring.GetUnitPieceList`, `GetUnitPieceInfo` (`parent`, `isEmpty`, `min`, `max`) and `GetUnitPieceMatrix`, in `rts/Lua/LuaSyncedRead.cpp`. Empty pieces report a `min` of 10000 and a `max` of -10000 on every axis, so `isEmpty` has to be read first.
- `GetUnitPieceMatrix` returns the piece's pose at the last sim frame, not the pose the model is drawn in. The engine draws a model part of the way from the frame before to this one. The widget does the same when it holds the frame before, and draws this frame's pose alone when the view draws slower than the sim runs.
- `GetUnitTransformMatrix` uses the unit's drawn position, so the skeleton follows the model between frames.
- A 3DO piece's box is about its own origin, as an S3O's is: `S3DOPiece::SetMinMaxExtends` takes it over the piece's own vertices (`rts/Rendering/Models/3DOParser.cpp`).

## Drawing

One vertex buffer, refilled every frame, drawn with one `DrawArrays` of triangles through one shader. Lines are strips two triangles wide, moved across themselves on screen by the vertex shader, darkened towards their edges and faded over the outermost part, because macOS draws `GL.LINES` one pixel wide whatever `gl.LineWidth` asks. Dots are quads the same shader spreads to a fixed size on screen and rounds. Each vertex carries its unit's radius as a share of `FULL_AT_RADIUS`, and the shader narrows lines and dots by how many pixels that radius covers, down to `SMALLEST` of their full size. Names are `gl.Text`. In `spring-headless` there are no buffers, so the widget logs that once and draws nothing.

## Splinter Faction and user widgets

Splinter Faction loads widgets from a data folder only when its `allowuserwidgets` mod option is on, and it is off by default (`LuaUI/widgets_custom.lua` and `ModOptions.lua` in 0.1.96). A player turns it on under Interface Options in the lobby's mod options, and a start script sets `allowuserwidgets=1` in `[modoptions]`. Without it the infolog says `Skipping N user widget file(s)` and the widget never loads. The engine's `LuaAutoEnableUserWidgets`, 1 by default, then decides whether a new user widget starts enabled.

## Tests

```
scripts/mission-tests.sh
luajit lua/skeleton-widget/tests/skeleton_test.lua
```

They cover the bone end on each axis and every tie, an empty piece giving a joint and no bone, the tree built from a fake piece map, the pose and the blend between frames, nothing drawn with no selection, the plan file read from `tests/fixtures/` (a unit with an entry, one without, no file, a broken file), which pieces are solid, dimmed, hidden, labelled and dashed, the other end and the straight bone of a piece that reaches both ways, depth colour, the taper, a piece moving against its parent and its fade, and the cursor's piece and its chain. Drawing needs a windowed engine, which CI does not have.
