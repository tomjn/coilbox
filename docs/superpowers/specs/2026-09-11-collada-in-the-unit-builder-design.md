# Opening a game's Collada models in the unit builder

Coilbox can now draw the models of a game whose units are Collada files, but the unit builder cannot open one. Picking flove in the builder's game picker gives an empty list under a note saying the archive holds no models, which is false: it holds 27 of them.

## What was measured

The picker keeps only two extensions (`src/lego/gameModels.ts:96`), so none of flove's `.dae` files enter the map it draws from. Every one of its 30 units then fails the lookup at `:113` and is counted as unresolved, which is why the list is empty and the note claims the models are absent.

That note is also ungrammatical. `GameModelDrawer.tsx:504` reads `${unresolved} name a model`, with no noun after the count, so it renders as "30 name a model this archive does not hold at all". It has read that way since it was written and predates this work.

Three facts about flove's own files shape the rest of this:

- 26 of its 27 models bind exactly one material. `KingShroom.dae` binds two.
- 24 of 27 carry a rotation on their nodes, which #2814 fixed in the reader.
- Every model names its texture in a Lua file beside it rather than in the model, because Collada has no Spring texture binding.

Two facts about the builder decide the shape of the work:

- It never opens an archive. The frontend extracts the member into a temp folder shaped like a game (`objects3d/` beside `unittextures/`), and the Rust side only ever reads loose files. A third format goes through that same seam.
- `import::import` takes a `coilbox_s3o::Model` and is public. `import_3do` converts a `.3do` into one and then calls it, so a format that can be expressed as an `.s3o` needs no new flattening walk.

The lego plugin already depends on `coilbox-springlua`, so reading the metafile adds no new dependency. Only `coilbox-assimp` does.

## Goals

- Open a game's Collada model in the builder, as a converted project, the way a `.3do` opens today.
- List those models in the game picker, and say something true when one cannot be opened.

## Not in scope

- Saving back over a `.dae`. The builder writes `.s3o`, so an opened Collada model is a converted copy.
- The metafile keys that move, rotate and reparent pieces, tracked in #2811.
- `.gltf` and `.glb` out of a game archive. The engine parses those itself, and the builder's existing `.glb` path is the Blender round trip rather than a game import.

## 1. Which formats

All five the reader handles, rather than Collada alone. The reader already does `.obj`, `.3ds`, `.lwo` and `.blend`, each filter this touches is a single list, and a game shipping one of the others would otherwise hit the same dead end for no reason. Collada is the one we can test against a real game today.

## 2. Reading and converting

Two commands, following the `.3do` pair:

- `lego_read_dae(path)` reports the texture names the model will ask for, so the frontend can put them beside it before the import runs. This is the probe `lego_read_3do` is for.
- `lego_import_dae(path, id)` reads the model, converts it to a `coilbox_s3o::Model`, and hands that to `import::import`.

The conversion is small because `coilbox-assimp` already returns triangles with per-vertex normals and UVs, and since #2814 a translation-only piece tree. The one structural difference is that a node may carry several meshes where an `.s3o` piece carries one vertex list, so a piece's meshes are concatenated with their indices offset.

`Imported`'s `.3do` counters stay at zero. `converted` does too, since the geometry arrives triangulated.

## 3. The metafile

The engine looks for `<modelpath>.lua` and then `<modelname>.lua`, and flove uses one of each spelling. The file is Lua and may compute the name, so it is evaluated with `coilbox-springlua` rather than scanned, the same call the worker's own reader makes through unitsync.

Both commands need it: the probe to report the texture name, the import to bind it.

## 4. Staging

`stageModel` extracts only the model member, so for a packed archive the metafile would not be on disk when the probe looks for it. It gains the metafile, both spellings, the way `stageTextures` already gains `palette.pal` for a `.3do`. A loose `.sdd` needs nothing, since the file is already beside the model.

## 5. The picker

Three filters decide what is offered, and all three take the same list of extensions: the member filter and the two name helpers in `gameModels.ts`, `openableInBuilder`, and the file dialog's own filter in `ImportDrawer.tsx`.

## 6. Saying something true when it cannot open one

The footnote gains its missing noun, and stops being one number. A unit whose model is a format the builder cannot open is a different thing from a unit whose model is absent, and the two are worth separate counts and separate sentences. Absent is usually a game depending on another archive. Unopenable is a file sitting right there.

## 7. Saving back

`writableSource` asks only whether the archive was loose. flove is a `.sdd`, so a Collada import would come back with a writable source pointing at a `.dae` while the builder writes `.s3o`. It has to ask what the source format is as well, and refuse anything it cannot write. The `.3do` path never hit this because a converted `.3do` is understood as a copy, and nothing in that function knows the difference.

## 8. What Collada holds that a Spring model cannot

Reported rather than papered over, following what the `.glb` import already does:

- Several materials. A Spring unit has one texture, so the first is taken and the count is reported. `KingShroom.dae` is the one flove model this costs.
- Points and lines, which are dropped.
- A texture the metafile names that the archive does not hold, which flove's `MushroomCluster` already does by naming `ClusterMushroom.png` when the file is `MushroomCluster.png`.

Reporting these needs counts the reader does not currently keep, so `coilbox-assimp` gains them: how many nodes carried a transform, how many distinct materials the meshes reference, and how many faces were dropped for not being triangles.

## 9. Testing

The crate gets a fixture binding two materials, since that is the case the one-texture rule loses something on, and the existing fixtures cover the rest.

`gameModels.ts` gets rows for a `.dae` and the two separate unresolved counts, which is where the empty list came from.

End to end, the check is flove in the builder's game picker: 27 models listed, one of them opening as a converted project with its texture on it.

## Sizing

M. The conversion is small and the picker changes are mechanical. The staging change and the save-back guard are the two places where getting it wrong is quiet rather than loud.
