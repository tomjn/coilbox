# In game blueprint widget

2026-08-23. Design for milestone 26, https://github.com/tomjn/coilbox/milestone/26, which is the one issue https://github.com/tomjn/coilbox/issues/1419. The issue is the brief. This records the decisions the brief left open and the file shapes that the widget and coilbox have to agree on.

Section "The in game widget" of `2026-08-12-base-blueprints-design.md` deferred this work and set its shape: coilbox ships its own widget, written from scratch, installed only when the player asks.

## What the player gets

A widget that lists the blueprints in their coilbox library, places one at the cursor as ghosts and build orders, and saves the buildings they have selected as a new blueprint that coilbox picks up. It reads BAR's `LuaUI/Config/blueprints.json` as well, so a BAR player sees layouts they already have. It never writes that file and never opens a network connection.

## Files on disk

Coilbox launches the engine with `SPRING_DATADIR` set to the content root and no `--write-dir`. Each engine folder carries a `springsettings.cfg`, which makes the engine folder the write dir. The content root is read only from the engine's point of view.

| File | Who writes | Who reads | Where |
|---|---|---|---|
| `LuaUI/Widgets/coilbox_blueprints.lua` and `LuaUI/coilbox_blueprints/*.lua` | coilbox, on install | the widget handler | content root |
| `LuaUI/Config/coilbox_blueprints.json` | coilbox, on every library change | the widget | content root |
| `LuaUI/Config/coilbox_blueprints_spool.json` | the widget | coilbox, when no game is running | `engine/<version>/` |
| `LuaUI/Config/blueprints.json` | BAR's widget | the widget | wherever BAR put it |

The spool has a different name from the library file on purpose. The engine's raw search order puts the write dir first, so a spool with the library's name would shadow the library.

### The library file

```json
{
  "version": 1,
  "blueprints": [
    {
      "id": "9a6c...",
      "name": "Front line eco",
      "game": { "name": "Beyond All Reason test-28000", "shortname": "BYAR" },
      "ordered": true,
      "buildings": [
        { "def": "armsolar", "offset": { "x": 0, "z": 0 }, "facing": 0 }
      ],
      "footprints": { "armsolar": { "x": 4, "z": 4 } }
    }
  ]
}
```

Each entry is `StoredBlueprint.id` plus its `layout`, which is `BlueprintPayload` from `src/blueprint/payload.ts`. Offsets are elmos from the layout origin, facing is 0 south, 1 east, 2 north, 3 west. The widget ignores `footprints`, because it has `UnitDefs`, and ignores `originalName`.

A `version` other than 1 makes the widget log once and show nothing from that file.

### The spool

```json
{
  "version": 1,
  "blueprints": [
    {
      "name": "Base on Supreme Isthmus 2",
      "game": { "name": "...", "shortname": "..." },
      "map": "Supreme Isthmus v1.9",
      "recordedAt": 1787000000,
      "ordered": false,
      "buildings": [ ... ],
      "footprints": { ... }
    }
  ]
}
```

No `id`. Coilbox assigns one when it collects, and then empties the file. `recordedAt` is `os.time()` and only there so a player can tell two saves apart if coilbox has not run yet. `footprints` are filled from `UnitDefs` (`xsize / 2`, `zsize / 2`) so coilbox's importer has them without running unitsync.

The widget reads the spool back on load and lists its entries alongside the library, so a saved base is placeable in the same match and survives a restart until coilbox collects it.

### Game filter

An entry is for the current game when it has no `game`, or its `game.shortname` equals `Game.gameShortName`, or it has no shortname and its `game.name` equals `Game.gameName`. BAR entries carry no `game` and are shown whenever the file exists, which is only under BAR in practice.

An entry whose building defs do not all resolve in `UnitDefNames` is listed only under the "all" tab, greyed, with the missing names in its tooltip line.

## Tabs

Three tabs, classified against the union of `buildOptions` over the selected units:

- now: every building in the layout is in the union
- partly: at least one is, and at least one is not
- all: everything for this game

With nothing selected that can build, the first two tabs are empty and say so. The classification is recomputed on `SelectionChanged`, not per frame.

## Placing

Choosing an entry enters placing mode. Each frame while placing:

1. `Spring.TraceScreenRay(mx, my, true)` gives the ground point under the cursor. Off map or over the sky, nothing is drawn.
2. The anchor is that point snapped to the 16 elmo grid.
3. Each building's offset is rotated by the layout rotation (0 to 3 quarter turns, `(x, z) -> (z, -x)` per turn, matching `turned()` in `src/blueprint/bar.ts`), added to the anchor, and snapped with `Spring.Pos2BuildPos(defID, x, y, z, facing)` where `facing = (building.facing + rotation) % 4`.
4. `Spring.TestBuildOrder(defID, x, y, z, facing)` marks each position. 0 is blocked and drawn red. Anything else is drawn in the team colour.

Ghosts are `gl.UnitShape` inside push, translate, rotate. Blocked squares are a flat quad per building on the ground, drawn from a VBO rebuilt when the snapped anchor or rotation changes.

Left click issues orders. For every selected unit, the widget collects the buildings its `buildOptions` allow, in layout order, as `{ -defID, { x, y, z, facing }, opts }` and sends them with one `Spring.GiveOrderArrayToUnitArray({ unitID }, cmds)`. The first command carries no options so it replaces the unit's queue, and the rest carry `shift`, which is what keeps an ordered layout in sequence. If the player holds shift, all of them carry `shift`. Buildings nobody selected can build are not ordered.

Right click or escape leaves placing mode. `[` and `]` rotate, and the actions `coilbox_blueprints_rotate_left` and `coilbox_blueprints_rotate_right` do the same for anyone who wants another key.

### The remainder

After a partial placement the buildings that were not ordered stay as ghosts at their world positions. The panel shows a remainder row with a count, a place button and a dismiss button. Place issues the remainder to the current selection with the same rules, and whatever it could not order stays. The remainder is one per match, so placing a second blueprint partially replaces the first remainder.

## Recording

`Spring.GetSelectedUnits()`, filtered on `UnitDefs[defID].isBuilding`. Each keeps its def name, position from `Spring.GetUnitPosition` and `Spring.GetUnitBuildFacing`. The anchor is the minimum x and z over the positions, each floored to the 16 elmo grid, and offsets are position minus anchor. Order is selection order, and `ordered` is false. The name is `"Base on <Game.mapName> <n>"` where n is one more than the spool count.

The entry is appended to the spool. If the spool is unreadable the save is refused with a message rather than overwriting it.

## Drawing

No immediate mode. `gl.Rect`, `gl.TexRect` and `gl.Vertex` are not used.

One shader program with attributes `pos` (vec2), `uv` (vec2) and `color` (vec4), uniforms `proj` (mat4, an orthographic matrix built in Lua from `Spring.GetViewGeometry`), `rect` (vec4, a position and size a unit quad is mapped into) and `useTex` (int). Two VAOs:

- the panel VAO holds every rectangle of the panel as two triangles, re-uploaded only when the layout changes, drawn with one `DrawElements`
- the quad VAO holds one unit square and is drawn once per build picture with `gl.Texture(0, "#" .. defID)` and `rect` set per picture

Text is `gl.Text`, which the engine already batches.

The layout is pure: `model.layout(state, measure)` returns rectangles, texts and pictures, and `model.pack(rects)` turns rectangles into the flat vertex and index arrays. Both are tested without an engine. The widget only uploads and draws.

Fixed row height, no wrapped text, names cut to fit with an ellipsis.

## Structure

```
lua/blueprint-widget/
  luaui/widgets/coilbox_blueprints.lua      callins, drawing, input, actions, WG
  luaui/coilbox_blueprints/json.lua         decode and encode, written here
  luaui/coilbox_blueprints/store.lua        library, spool and BAR file, polling
  luaui/coilbox_blueprints/model.lua        tabs, filters, selection, layout, packing
  luaui/coilbox_blueprints/place.lua        rotation, snapping, orders, remainder
  luaui/coilbox_blueprints/record.lua       selection to entry
  tests/                                    luajit suites, not installed
  README.md
```

Modules are loaded with `VFS.Include(path, nil, VFS.RAW_FIRST)` from the widget, the way the mission UI does. Each module takes the engine tables it needs as arguments rather than reading globals, so a test hands it a stub.

`WG.CoilboxBlueprints` exposes `open`, `close`, `toggle`, `list`, `place(key)`, `save()` and `rotate(turns)`. The widget action `coilbox_blueprints` toggles the panel and `coilbox_blueprints_save` records.

## Polling

The store re-reads the library and the BAR file when the panel opens and every five seconds while it is open, through `VFS.LoadFile(path, VFS.RAW)`. It compares the raw text with the last read and re-parses only on change. Five seconds and only while open keeps a closed panel free.

## Coilbox side

Phase 2, after the widget. Three pieces, each small:

1. Export: write the library file into the content root whenever `content_blueprint_save` or `content_blueprint_delete` runs. One Rust function in the content plugin beside the existing blueprint store.
2. Collect: on app start and whenever the library page opens, and only when no game is running, read every `engine/*/LuaUI/Config/coilbox_blueprints_spool.json`, import each entry through the existing `StoredBlueprint` path with source `{ kind: "widget" }`, and empty the spool.
3. Install: a button on the library page that copies `lua/blueprint-widget/luaui/` into `<content root>/LuaUI/`, shows which version is installed, offers update when coilbox ships a newer one, and removes. `tauri.conf.json` gains `"../lua/blueprint-widget": "blueprint-widget"` next to the mission runtime. The copy follows `crates/tauri-plugin-coilbox-scenario/src/runtime.rs`: resource probing, case resolving copy, prune only files named `coilbox_blueprints*`.

Coilbox never installs or updates without the click, and after install tells the player to enable the widget from F11.

## Open check

Whether a game's own widget handler scans all raw data dirs or only the write dir. The engine's stock handler scans all (`cont/LuaUI/widgets.lua:334`, `VFS.DirList(WIDGET_DIRNAME, "*.lua", VFS.RAW_ONLY)`). BAR's handler is BAR's and has not been read. If it looks only at the write dir, the fallback is a per engine install, and `carry_widget_config` will not carry it forward.

## Testing

Every module except the widget file runs under `luajit` with stubs in `lua/blueprint-widget/tests/support.lua`: `VFS`, `Spring`, `UnitDefs`, `UnitDefNames`, `Game`, `io`. `scripts/mission-tests.sh` loops over `lua/*/tests/*_test.lua` so the new suites run in the same CI job.

The widget file itself, and everything that touches `gl`, cannot be verified without an engine that opens a window. That is the boundary the issue asks to stop at.
