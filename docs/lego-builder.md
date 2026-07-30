# The unit builder

Assemble a Recoil or Spring unit out of pre-textured parts, animate it from a preset, and write it into a game. No modelling, no UV work: every part in a pack shares one texture, so anything you build from them is already mapped.

The builder is a modding tool, so it is hidden until you turn on **Advanced mode** in Settings > General. It then appears in the sidebar as **unit builder**, with **Units** for what you have built and **Lego Parts** for what you can build from.

![The unit builder: a unit on a marked ground plane, tool buttons down the left, the piece tree and the selected piece's settings on the right, and the parts strip along the bottom.](/screenshots/lego-builder.png)

Two things to know before you spend an evening on this:

- A unit you export cannot be built or moved in a game yet. The only way to see it is `/cheat` then `/give`. See [what an exported unit cannot do](#what-an-exported-unit-cannot-do-yet).
- An exported unit has been loaded in a headless engine, which proves its pieces, its size and its script are right. Nobody has yet seen one drawn, so nothing has confirmed it looks right. See [the engine load checklist](#the-engine-load-checklist).

## Build a unit

Go to **Units** and press **New unit**. That gives you an empty unit with one piece, `base`, which is the root everything else hangs off.

**Name it.** The name at the top left is what the unit is called in the overview. Under it is the export name, which is the base name of every file the export writes, and a Lua identifier, so it is lower case with underscores. It follows the title until you set it to something of its own.

**Add parts.** The strip along the bottom is the parts library. Search it, narrow it by colourway, and click a part to add it. A new piece hangs off whatever is selected, so building outward from a hull section is the default rather than something to set up. Collapse the strip with the chevron when you are done reaching for parts.

**Move it.** Drag the gizmo in the 3D view, or type numbers into the selected piece's Position, Rotation and Scale fields. `G`, `R` and `S` switch the gizmo between move, turn and scale. Dragging snaps to the corners, face centres and middles of nearby pieces. Hold `Alt` while you drag to place freely. The view names what a drag has snapped to while you do it.

**Say what each piece is.** With a piece selected, the panel on the right sets:

- **Name.** Lower case and unique, because a unit script addresses pieces by name.
- **Hangs off.** Which piece carries it. Dragging a row onto another in the tree does the same thing.
- **Turns about.** Where the piece's origin sits inside its part: middle, top, bottom, left, right, front or back. This is the point the piece turns about and the point its children hang from. A leg wants its top, not its middle.
- **Role.** What the piece is, so the animation presets know what to move.

**Add empty pieces** with the `+` above the piece tree. An empty piece has no geometry. It carries other pieces, and it is how flares, aim points and emit points are made. Empty pieces are real pieces in the exported model, not an editor convenience.

**Hide a piece** with the eye button on its row in the tree, to get it out of the way while you work on what is behind it. Hiding is editor-only: a hidden piece is still exported.

**Sit the unit on the ground** with the arrow button in the left-hand toolbar, which drops the whole unit so its lowest point is at ground level.

Everything saves itself shortly after your last edit. The Save button forces it, and the label beside it says whether there is anything outstanding.

### Keyboard shortcuts

Press `?` for the full sheet, or the keyboard button in the bottom right of the view. It is generated from the same table the handlers dispatch through, so it cannot fall out of step with what the keys actually do.

The ones worth learning first are `G`, `R` and `S` for the three gizmo modes, `F` to frame the selected piece, and `Alt` held down to place a piece off the snap grid.

### The piece actions

The buttons down the left of the 3D view act on the selected piece: duplicate, paste, save as a compound, delete. They are in the view rather than the sidebar because that is where the piece is.

Copy and paste go through the system clipboard, so they cross windows. Copy a leg in one unit, paste it into another. Anything on the clipboard that is not a piece is rejected with a reason. A pasted piece whose part is not in any installed pack still pastes: the names, the hierarchy and the transforms are real work, so they are kept and the missing geometry is reported rather than dropped.

## Compounds

A compound is an assembly you saved to use again: a leg, a turret, a cab. Build it once out of parts, save it, and drop it into the next unit.

Compounds are the answer to "where do I get a leg from". The alternative is copying pieces out of somebody else's game, which is somebody else's work and somebody else's licence. A compound is yours.

Select the top piece of the assembly and press the compound button in the left-hand toolbar. It appears under the **Compounds** tab of the parts strip, where you can rename it, delete it, and click it to drop a copy into the unit you are working on. A compound is defined by how its pieces sit against each other, so it lands wherever you put it rather than where it originally was. Names are made unique as it lands, because two pieces called `barrel` would be one piece too few for a script.

## Judging size

A unit built from small parts can look substantial and be a fraction of a real one, so the builder gives you two readings.

The **ground** is marked in elmos: fine lines every elmo near the origin, heavier lines every footprint step, which is the 16 elmos the engine reserves ground in. Translucent plates at the origin mark the 1x1, 2x2, 3x3 and 5x5 footprints, each with its size written on it, so "does this fit a 3 by 3" is something you can see.

The **reference unit**, the sun button in the bottom right, stands a real unit beside yours at its real size: Beyond All Reason's Armada solar collector, 43 elmos across and 29 tall. Anyone who plays these games has built hundreds of them. Its geometry is baked into coilbox rather than read out of an installed game, so it is there whatever you have installed. Attribution and licence are in `src/lego/reference/LICENCE.txt`.

## Which way it faces

A blue arrow on the ground, labelled **front**, marks model `+z`: the direction `Spring.GetUnitVectors` calls `frontdir`, pinned by the headless engine run on [issue #565](https://github.com/tomjn/coilbox/issues/565). Model `+y` is up, and model `+x` is the unit's left, being the negative of `rightdir`, not its right.

Unlike the grid and the axes helper, this one has no toggle. Get a unit's facing wrong and the only way to find out used to be in a game, so it stays on rather than risking a builder forgetting to turn it back on.

## Roles and animation presets

An animation preset is a canned motion. It does not ask you to key anything: it asks which piece is the turret, which is the barrel, which is the front left thigh. That is what a **role** is, and it is why roles are a fixed list rather than free text.

Set a role on the selected piece in the Pieces panel. The roles are grouped: Body and Door under Structure, Turret, Barrel, Muzzle flare and Aim point under Weapon, Wheel under Movement, three segments for each of four legs, and three parts of a build arm.

Then open the **Animation** tab. Each preset says what it does and what it needs, and one it cannot use yet names the missing role rather than sitting greyed out with no explanation:

| Preset | Needs |
| --- | --- |
| Walk, two legs | A thigh and a shin on each side of one pair |
| Walk, four legs | A thigh on all four legs |
| Turret sweep | A turret, and a barrel if there is one |
| Wheels turning | At least one wheel |
| Build arm | A build arm |
| Doors | At least one door |
| Hover and bob | A body |
| Aim point | An aim point |
| Recoil on firing | A barrel |
| Idle sway | A body |
| Wreck pose | A body |

Applying one gives you sliders for its own parameters: stride time, thigh swing, sweep angle, kick distance and so on. **Play** runs everything applied, in the viewport, over the unit's built pose. Nothing about playback is written to the unit, so stopping restores exactly what you built. Playback stays off if your system asks for reduced motion.

The file button at the top of the panel shows the unit script the presets generate, ready to copy. It is Lua, it declares a local only for the pieces it actually uses, and it is sampled from the same maths the viewport plays, so the two cannot drift apart.

Presets are demonstrations of motion, not the motion itself in every case. A turret in a game points where the target is, and the sweep you see in the viewport is what that motion looks like.

## What export writes

**Export** asks for a game folder, which is the folder holding `objects3d` and `unittextures`. For a game you are working on that is the `.sdd` directory. The folder is remembered on the unit, so exporting again after a change is one click.

It always writes:

- `objects3d/<unit>.s3o`, the model.
- `units/<unit>.lua`, a unit definition. Without one the engine has nothing to spawn.

It writes, if you leave the boxes ticked:

- `scripts/<unit>.lua`, the unit script the animations generate.
- The pack's atlas into `unittextures/`. Every unit built from a pack names the same texture, so this only needs doing once per game rather than once per unit.

It can also write a `.glb`, or an `.obj` with its `.mtl` and a copy of the atlas beside them. Neither is read by the engine. Both go into a `blender` folder alongside the game's own, for taking the unit into Blender to check it against the `.s3o` or finish it by hand.

**The script, the unit definition and the texture are all written once and then left alone.** If any is already there, export keeps yours and says so. The script and the unit definition are meant to be edited: the unit definition coilbox writes is the minimum the engine needs to accept the unit, and adding weapons, cost, a build picture or a movement class is a hand edit that has to survive re-exporting the model. Only the model is overwritten every time, because it is the one file the builder alone owns.

The one exception is coilbox's own scratch game, below, which is a throwaway and is always rewritten in full.

**What it deliberately does not write:** anything about the game around the unit. No weapon definitions, no cost, no build picture, no side or category, no movement class, and no edit to any other unit's `buildoptions`. Export puts a unit in a game folder. Making the game use it is your decision to make, in files you already own.

## The collision volume

The collision volume is the shape the engine hits, clicks and shoots at. It is not the model: a unit is selected, shot and blocked by its volume, whatever its geometry looks like.

A unit definition that names no volume gets the engine's own, a sphere around the whole model, which for anything longer than it is wide is a much bigger click target than the unit looks. So export always writes one. By default it is the unit's own bounding box, which is the tighter of the two and needs no decision from you.

The **Collision** tab beside Pieces and Animation shows what will be written, and lets you replace it. Pick a shape, then set its size and where it sits:

- **Size** is the volume's full width on each axis, not its radius. The engine halves it.
- **Offset** is measured from the middle of the unit, so zero is centred on it.

Changing anything takes the volume over, and it is then saved with the unit. **Use the bounding box** hands it back, and the derived volume follows the geometry again as you build.

You do not have to type any of it. While the Collision tab is open the viewport's move and scale handles are on the volume rather than on a piece, so you can drag it to size and watch the numbers follow. There is no rotate handle, because a volume has no rotation: the engine measures it along the model's own axes.

Two shapes cannot be stretched, and the engine says so rather than the panel: a sphere takes the largest of the three sizes for every axis, and a cylinder takes the larger of the two across it for both. The viewport draws what the engine will end up with rather than what was typed, so a sphere dragged out on one axis comes back round.

The box button in the viewport's camera group draws the volume as an orange wireframe, over the model, so you can keep an eye on it while building rather than only while setting it.

Nothing here is per piece. The engine can also collide a model piece by piece, which is a different job with a different answer, and coilbox does not write it.

## Test in game

**Test in game** is the shortest honest route from a unit in the builder to a unit on a map. Everything else is a guess until the engine draws it.

Pick a game to build on and a map. Coilbox writes a scratch game of its own, `coilbox-lego-test.sdd`, into the content root's `games/` folder. It depends on the game you picked, which supplies the sides, the rules and everything else, and the scratch archive adds only your unit. Your install is not touched, and deleting that one folder undoes everything the flow has ever written.

Coilbox then rescans, so the engine picks the scratch game up, and launches a one-player skirmish on the map you chose.

Once you are on the map, press Enter and type:

```
/cheat
/give <unit>
```

Cheats have to be on before `/give` does anything. Spawning is left to you: `/give` is one line to type and a spawner would be a gadget to maintain.

You need an engine, at least one game and at least one map installed. The drawer says which of those is missing rather than failing at launch.

## What an exported unit cannot do yet

A unit coilbox exports cannot be played normally. Its unit definition sets `canmove = false`, and nothing lists it in any unit's `buildoptions`, so nothing can build it and it cannot move. `/cheat` and `/give` is the only way to get one onto a map.

`canmove` is off because the engine drops a unit that can move but has no movement class, and the builder has no notion of movement classes, so leaving it off is what keeps every export loadable. How a custom unit should properly enter a game, which builder gains it as an option or whether it arrives another way, is an open design question: [issue #663](https://github.com/tomjn/coilbox/issues/663).

## The engine load checklist

**Result: three of five proved, two still outstanding.** The check is: export a unit into a `.sdd` working copy or use **Test in game**, get it onto a map with `/cheat` and `/give`, and confirm all five of:

1. The model renders at all. **Outstanding.**
2. Its orientation and handedness are right, so it faces the way it did in the builder and is not mirrored. **Proved.**
3. Textures land on the right geometry. **Outstanding.**
4. The selection volume is sane, so clicking the unit selects it and the volume is neither a speck nor the size of the map. **Proved.**
5. The infolog has no Lua error from the unit script. **Proved.**

Three of them no longer need a machine that can draw. `spring-headless` runs a full simulation with no OpenGL context, and the engine's Lua tells you where it thinks every piece is, how big the unit is, and whether the unit script bound. An L-shaped probe unit, exported through the normal path and spawned twice at different facings, settled them:

- **Handedness.** Spring derives a piece's emit position from its first two vertices, so `Spring.GetUnitPiecePosDir` returns a point predictable from the file alone. Every piece landed where the file says, to four decimal places, at both facings. The transform from model space to world space is a rotation, determinant +1, not a reflection. Nothing mirrors the model, including a piece scaled `-1, 1, 1`.
- **Orientation.** Model `+z` is the unit's front, model `+y` is up, and model `+x` is the unit's left. The builder marks this on the ground: see [Which way it faces](#which-way-it-faces).
- **The selection volume.** `Spring.GetUnitRadius` and `GetUnitHeight` return the s3o header values exactly, and the engine's default collision volume is the smallest sphere containing the geometry. Sane, but a sphere is a generous click target for a long unit, so an export now writes a volume of its own: see [The collision volume](#the-collision-volume).
- **The infolog.** Nothing in it names the unit, its model or its script. `Spring.UnitScript.GetScriptEnv` returns an environment carrying exactly the call-ins the generated script declares, so the script loaded and bound rather than merely failing quietly.

The two still outstanding both need pixels. Nobody has seen the unit drawn, and nothing has checked which part of the atlas each triangle samples. [Issue #563](https://github.com/tomjn/coilbox/issues/563) is the cheaper of the two to settle, because Blender needs no engine.

The same run found the footprint was wrong: it was derived from the collision radius, so a unit longer than it is wide claimed far more ground than it stood on. Fixed in [issue #679](https://github.com/tomjn/coilbox/issues/679): the footprint now measures x and z off the model's own bounding box, each axis rounded up to its own step. Reverified headless on an asymmetric probe (48 by 6 elmos): the exported definition wrote `footprintx=3 footprintz=1`, and `UnitDefs[id].xsize/zsize` in a running engine read back `6` and `2`, a rectangle rather than the square the old code would have claimed.

Record any further outcome here, and on [issue #565](https://github.com/tomjn/coilbox/issues/565), rather than remembering it.

## Parts packs

The bundled pack is derived from Splinter Faction's Lego Models, reused with the author's permission. Several packs can be installed at once and they share one atlas, so parts from all of them can sit in the same unit. A pack picker appears in the parts filters once there is more than one. The format, where extension packs go and how to build one are in [the parts pack guide](/lego-parts-pack).

A unit records the pack it was built against. Opening one whose pack is not installed still works: the pieces keep their names, hierarchy and transforms, and any piece whose part is missing draws nothing and is counted in the warnings above the viewport.
