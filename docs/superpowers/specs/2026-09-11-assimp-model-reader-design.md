# Assimp model reader for .dae and the other engine formats

Coilbox reads two model formats, `.3do` and `.s3o`. The engine reads nine. A game whose units are Collada files, such as flove, shows a unit page with no model, no thumbnail and a message blaming unitsync for a file that is sitting in the archive. This adds a reader for the five formats the engine loads through Assimp.

## What was measured

flove ships 27 `.dae` files under `Objects3d/` with 23 Lua metafiles beside them, and no buildpics at all, so there is no fallback picture either. Asked for one of them, the worker answers `flove.sdd has no model for "spire.dae" under objects3d/`, while the same call against Balanced Annihilation's `AMGEO` returns a full `.3do` piece tree. The cause is `find_model` in `crates/coilbox-unitsync-worker/src/unitmodel.rs:680`, which only ever builds `.3do` and `.s3o` candidate paths.

A probe read `spire.dae` through `russimp` and returned 19 meshes, one material, and a named node tree with parent-relative translations: `Stalk` with `Branch1` to `Branch5` under it, each carrying `Leaves`. That is the shape `ModelPiece` already wants.

Build facts, all from local runs on macOS arm64:

- `russimp` from crates.io cannot build. The published `russimp-sys` package ships `assimp/include` and no `CMakeLists.txt`, so the build script panics.
- From git it builds, but only with `CFLAGS="-Dfdopen=fdopen"`. Assimp 5.3.0 vendors zlib 1.2.13, whose `contrib/zlib/zutil.h:142` guards on `TARGET_OS_MAC`, which is defined on every modern Mac, and defines `fdopen` away. That breaks the SDK's own declaration.
- The `prebuilt` feature cannot help. Every russimp-sys release ships x86_64 assets only, and both the development machine and the `macos-14` release runner are arm64.
- Cold build 1m37s release. `libassimp.a` is 20.0 MB debug. A release binary of a trivial program plus static Assimp is 8.8 MB.
- CMake and Ninja 1.13.2 are preinstalled on `ubuntu-22.04`, `macos-14` and `windows-2022`.

Assimp is BSD 3-clause and coilbox is MIT, so the licences fit. The engine vendors Assimp 4.0.1 (`rts/lib/assimp/CMakeLists.txt:120`) while russimp pins 5.3.0, so our output can differ from the game's in edge cases. Nobody publishes a Rust binding to Assimp 4, so matching the engine exactly is not available at any reasonable price.

## Goals

- flove's units draw everywhere a unit model is drawn: the unit page, the hero viewport, thumbnails, the archive preview and the scenario picker.
- All five whitelisted formats read, not just Collada.
- A model coilbox genuinely cannot read says so, instead of claiming the game has no model.

## Not in scope

- The metafile keys that move, rotate, scale and reparent pieces, plus `s3ocompat`, `nodenamesfromids` and the bounds overrides. Filed as #2811. None of our games use them.
- `.gltf` and `.glb`. The engine has its own parser for those and does not route them through Assimp.
- Opening a `.dae` in the unit builder. The builder stays `.3do` and `.s3o`.
- Writing any of these formats. This is a reader.

## 1. The dependency

`russimp` 3.2.1 with the `static-link` feature, plus a `[patch.crates-io]` entry pinning `russimp-sys` to commit `3ec28662fc23288d19c2f8e6796d060083868e4d`. The pin is exact and lands in `Cargo.lock`.

`CFLAGS="-Dfdopen=fdopen"` has to be set wherever the worker is built. That means the Rust lint job, the release matrix, and the two `bun run sidecar:unitsync` paths. The flag defeats zutil.h's `#ifndef fdopen` guard, so the broken define never happens.

The open risk is that only macOS is proven. The zlib guard should not fire on Linux or Windows, so the flag should be a no-op there, but the first CI run is what proves it. If Windows fails for a different reason, that is the point to reconsider rather than push on.

## 2. New crate, coilbox-assimp

A crate beside `coilbox-3do` and `coilbox-s3o`, following the same shape: take bytes, return a parsed model, never touch the filesystem or an archive.

Input is the file bytes plus an extension hint, because archives are packed and the worker already holds members as bytes. `Scene::from_buffer_with_props` (`russimp-3.2.1/src/scene.rs:511`) takes exactly that and lets us set the importer properties.

The post-processing flags match the engine's `ASS_POSTPROCESS_OPTIONS` (`rts/Rendering/Models/AssParser.cpp:51-63`) in full: remove component, find invalid data, calculate tangent space, generate smooth normals, triangulate, generate UV coords, sort by primitive type, join identical vertices, limit bone weights and split large meshes. `ImproveCacheLocality` stays off, as it is in the engine, where a comment records it crashing an old Assimp assert.

Two of those need a decision rather than a copy.

`RemoveComponent` is driven by `AI_CONFIG_PP_RVC_FLAGS`, which the engine sets to strip cameras, lights, textures, animations and materials (`AssParser.cpp:65-71`). We set the same value. Note what it does not do: flove's `spire.dae` carries a camera, and with the flag on, a piece called `Camera` still comes back, because the flag discards the camera object rather than the node that referenced it. Measured, not assumed. The engine keeps that node too, so this is parity rather than a defect, and flove's models arrive with a handful of pieces named after cameras and texture groups.

`SplitLargeMeshes` is left out entirely. The engine bounds it with limits it reads from the GPU at runtime, and a headless reader has no GPU to ask. Splitting exists to keep one draw call inside what a driver accepts, which is a drawing concern rather than a reading one, and choosing a limit here would mean inventing a number the engine never used.

## 3. Worker wiring

Three small changes in `unitmodel.rs`, each at a point that already exists:

- `find_model:680` gains the five extensions in the engine's registration order, after `.3do` and `.s3o`. Order decides which file wins when a game ships two.
- `build:445` gains a branch dispatching on extension.
- `locate_texture:868` gains a branch for the new formats' texture rules.

`format` in `UnitModelOutput` gains a value naming the real format, so the frontend and the unit page can show it.

## 4. Textures and the metafile

The engine looks for `<modelpath>.lua` and then `<modelname>.lua` (`AssParser.cpp:522-534`). flove uses both spellings, so both are needed on day one.

The worker reads it through unitsync's own Lua parser with the archive already mounted, the same route `gamedata/defs.lua` takes. That matters because the worker's mlua is a dev-dependency (`crates/coilbox-unitsync-worker/Cargo.toml:71`), so the worker links no Lua VM today, and this route adds none. It also reads out of a packed `.sdz` as easily as a loose `.sdd`.

Only `tex1` and `tex2` are read, then the engine's fallback chain when the metafile names nothing: by model name under `unittextures/`, then the first material's texture property. A `.dae` carries no Spring texture binding of its own, so without this step the geometry has nothing to paint on it.

## 5. Piece tree

Every `aiNode` becomes a `ModelPiece`, which is what the engine does too, so nodes carrying no mesh stay as hierarchy. The name comes from the node. The offset comes from the decomposed node transform and stays parent-relative, because `ModelPiece.offset` is defined that way and the frontend nests `Object3D`s to accumulate it. Each mesh on a node becomes a `ModelGroup` with positions, normals, UVs and indices local to that group.

## 6. Saying why a model is missing

Today an unreadable format is folded into "this unit has no model", and the unit page prints "Could not reach unitsync to read this unit's model", which is wrong twice over. Once the reader lands, a genuinely unsupported extension should say the archive holds the file and coilbox cannot read that format. This is worth keeping even after the reader exists, because four engine formats will still be unreadable if Assimp itself rejects a file.

## 7. Frontend

Almost nothing. `unitModel.ts` already gates its `.s3o`-only behaviours, team-colour painting and the cutout mask, on the `format` string, so a new format falls through to a plain textured draw. `assetKinds.ts:81` already lists `.dae` as an engine format. `openableInBuilder` stays as it is, and its existing message about the builder reading only `.s3o` and `.3do` stays correct.

## 8. Testing

The crate gets a small hand-made Collada fixture rather than one of flove's files, which are GPL and not ours to vendor. A cube with two nested nodes and one material covers the piece tree, the offsets and the material lookup.

The worker gets `find_model` cases in the existing synthetic-listing style at `unitmodel.rs:974`, covering extension order and a game shipping both a `.3do` and a `.dae`.

End to end, the check is flove itself: `--unit-model flove.sdd spire.dae` returning a tree rather than an error, then the unit page in a running app.

## Sizing

L. The crate and the wiring are each M on their own, and the CI work is the part most likely to surprise, since two of three platforms are unproven.
