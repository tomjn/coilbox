# Compatibility mode fixes

Compatibility mode runs an old game on a current engine. Coilbox writes a generated game that depends on the old one and adds fixes on top, and launches that instead. This page is for a game maker who wants to know what that generated game does to theirs, and for anyone adding a fix to coilbox.

For what a player sees and does, see [Compatibility mode](../players/compatibility-mode.md). That page also lists every fix in the newest version.

## What coilbox writes

The generated game is a folder, `coilbox-compat-<stem>-<n>.sdd`, in the content folder's `games/`. `<stem>` is the old game's archive name in lower case without its extension, and `<n>` is the compatibility version, which is the number of the manifest it was built from. The old game's archive is never edited.

The folder holds:

- `modinfo.lua`. The game is named `<game> (compat <n>)`, its version is `<n>`, and it depends on the old game. It carries the old game's `shortname`, so Lua that checks `Game.gameShortName` sees the old game.
- `compat/prelude-synced.lua` and `compat/prelude-unsynced.lua`, the Lua prelude for each Lua state.
- The old game's Lua entry files, each with the prelude loaded first: `LuaRules/main.lua`, `LuaRules/draw.lua`, `LuaGaia/main.lua`, `LuaGaia/draw.lua`, `luaui.lua` or else `LuaUI/main.lua`, and `LuaIntro/main.lua`. Only the files the game has are written. The `VFS.Include` of the prelude goes on the original's first line, so every line keeps its number in an error.
- `LuaRules/Gadgets/coilbox_compat_<name>.lua`, one per gadget fix.
- `gamedata/defs_post.lua`, which points units, features and weapons at the converted models, runs the def fixes for that file, and then runs the engine's own copy.
- `gamedata/weapondefs_post.lua`, which runs the weapon def fixes and then the engine's own copy.
- The converted models under `objects3d/`, with their textures under `unittextures/3do/`.
- `.coilbox-compat.json`, which records the manifest version, the writer, the old game's checksum and the coilbox version that built it.

A game that ships its own `gamedata/defs_post.lua` or `gamedata/weapondefs_post.lua` would have it covered up by the generated one. So coilbox writes neither file for such a game, and the player's build result says so. The same happens when the game's own `gamedata/defs.lua` or `gamedata/weapondefs.lua` never loads the file.

## The same bytes on every computer

Players in a multiplayer battle compare archive checksums. Coilbox writes the folder the same way on every computer from the same game and manifest: files sorted by path, LF line endings, and no timestamps or paths. A player on a different compatibility version then has a missing archive rather than a game that desyncs.

The record file is the one file that differs, because it names the coilbox version. Its name starts with a dot, and the engine leaves such files out of an archive's checksum (`CreateIgnoreFilter` in `rts/System/FileSystem/ArchiveScanner.cpp`).

Nobody downloads a generated game. A player who joins a battle on `<game> (compat <n>)` has coilbox build manifest `<n>` from their own copy of the old game.

## How the fixes run in a game

Each prelude fix and def fix runs as a function inside `pcall`. A fix that fails logs `coilbox compat fix <id> failed: <error>` to the `coilbox-compat` log section, and the game's own Lua still loads.

The prelude's first fix, `compat-callin-hooks`, gives the others `compat.define`. That puts a function in place only when nothing is there already, so a game that defines its own keeps it.

Each gadget decides when the game loads whether the game needs it, from the game's own files. Every game built from one manifest gets the same gadget files. A gadget's name starts with `coilbox_compat_`, so it can be told apart from the game's own in the log.

Each def fix looks at every definition as the game left it, and changes only those that set the tag it is for.

## The registry

The fixes are Lua files in `lua/compat/`:

- A prelude fix is a file directly in `lua/compat/`.
- A gadget fix is in `lua/compat/gadgets/`.
- A def fix is in `lua/compat/defs/`.
- `lua/compat/manifests/<n>.json` is the manifest for compatibility version `<n>`.
- `lua/compat/manifests/hashes.txt` holds the SHA-256 of every fix a manifest lists.
- `lua/compat/tests/` holds the Lua tests.

`crates/coilbox-compat/src/lib.rs` embeds every one of these files with `include_str!`, in the `MANIFESTS` and `FIXES` lists, so a build reads nothing at run time. `crates/tauri-plugin-coilbox-compat` writes the folder.

A fix file starts with a header of `-- key: value` lines:

```lua
-- id: spring-unit-travel
-- catalogue: removed:Spring.GetUnitTravel, removed:Spring.SetUnitTravel
-- states: synced
-- license: MIT or GNU GPL, v2 or later
```

- `id` is the file name without `.lua`.
- `catalogue` lists the ids of the entries in `src/data/engineLuaCompat.json` that the fix addresses. It can be empty.
- `license` is always `MIT or GNU GPL, v2 or later`, as in `lua/LICENSE.md`.
- `states` makes it a prelude fix and names the Lua states it runs in, `synced`, `unsynced` or both.
- `gadget: coilbox_compat_<name>` makes it a gadget fix and names the gadget and its file.
- `defs` makes it a def fix and names the files it runs in, `defs_post`, `weapondefs_post` or both.

A manifest lists its fixes in order, and names the 3do converter and the writer it was built with:

```json
{
  "version": 5,
  "fixes": [
    "compat-callin-hooks",
    "spring-unit-travel",
    "gadget-aircraft-crash-83-v2",
    "defs-helpers",
    "defs-commander-85"
  ],
  "converter": {
    "crate": "coilbox-3do-convert",
    "version": "0.1.0"
  },
  "writer": 1
}
```

That is a shortened `5.json`. The real one lists 18 fixes.

## A fix never changes once it ships

Two players on the same manifest have to write the same bytes. If a fix changed after a manifest listed it, two coilbox versions would build different games under one name. So a fix is fixed for good once a manifest lists it.

To change a fix, add a new fix with a new id, and a new manifest that lists it in place of the old one. Keep the old file, because the older manifests still list it. `gadget-aircraft-crash-83-v2` is an example. Manifest 3 lists `gadget-aircraft-crash-83`, and manifest 4 replaced it with the v2 file. Both files are still in `lua/compat/gadgets/`.

`hashes.txt` is what holds this in place. The test `recorded_hashes_match_the_embedded_fixes` in `coilbox-compat` fails for a listed fix whose file no longer matches its recorded hash, with "changed after it was listed. Add a new fix with a new id instead".

The call-in adapters in `ADAPTERS` in `crates/coilbox-compat/src/lib.rs` follow the same rule. They decide which of the `UnitDamaged` and `AllowCommand` fixes a game gets, so changing one needs a new manifest too.

## Add a fix

1. Write the fix as `lua/compat/<id>.lua`, `lua/compat/gadgets/<id>.lua` or `lua/compat/defs/<id>.lua`, with the header above. The file must end in a newline and have no carriage returns. All of it must be your own code. Copy nothing from the engine's `examples/Widgets` or `cont/LuaUI`, or from any game.
2. Add `(id, include_str!(...))` to `FIXES` in `crates/coilbox-compat/src/lib.rs`, which is in alphabetical order by id.
3. Copy the newest manifest to `lua/compat/manifests/<n>.json`, with `<n>` one higher. Set `version` to `<n>` and add the new id to `fixes`. `compat-callin-hooks` must stay first among the prelude fixes, and `defs-helpers` first among the def fixes.
4. Add `(<n>, include_str!("../../../lua/compat/manifests/<n>.json"))` to `MANIFESTS` in the same file.
5. Record the hash. Run `shasum -a 256` on the fix file and add a line of the hash, two spaces and the id to `lua/compat/manifests/hashes.txt`.
6. For a def fix, add its id to `COUNTED` in `crates/tauri-plugin-coilbox-compat/src/defs.rs` and count the definitions it changes in `changed` there. The test `every_def_fix_but_the_helpers_is_counted` fails until you do.
7. For a gadget fix, add what it would act on to `gadgetFinding` in `src/content/compatReport.ts`, so the report's "Compatibility gadgets a build turns on" row lists it.
8. Add tests to `lua/compat/tests/`, in `prelude_test.lua`, `gadgets_test.lua` or `defs_test.lua`, and run `scripts/mission-tests.sh`.
9. Add the golden line. Run `cargo test -p tauri-plugin-coilbox-compat the_fixed_games_build_the_same_bytes_from_every_manifest`. It fails and prints the hash it built for each manifest. Add the new manifest's line to `GOLDEN` in `crates/tauri-plugin-coilbox-compat/src/lib.rs`. Every older line must come out the same as before. If one has moved, read the next section first.

Players get the new manifest when they update coilbox. Their switches stay on, and each game shows Rebuild until they rebuild it.

## When the writer changes

The fixes are held by their hashes, but the code around them decides the bytes too. That covers how the prelude wraps the fixes and the entry files, which adapters a game's handlers pick, the `modinfo.lua` and `defs_post.lua` text, and how the worker converts models. `WRITER` in `crates/coilbox-compat/src/lib.rs` is the newest version of that code.

Coilbox keeps every writer's behaviour and builds a manifest with the writer it names. A player on a newer coilbox who joins a host on an older manifest builds that manifest with its old writer, and gets the host's bytes. A coilbox refuses a manifest that names a writer newer than its own `WRITER`, which only a newer coilbox can have.

Three golden tests hash a fixed build and fail when the bytes change:

- `the_fixed_games_build_the_same_bytes_from_every_manifest` in `crates/tauri-plugin-coilbox-compat/src/lib.rs`, one line per manifest.
- `a_fixed_game_converts_to_the_same_bytes` in `crates/coilbox-unitsync-worker/src/convert3do.rs`.
- `a_fixed_game_scans_to_the_same_handlers` in `crates/coilbox-unitsync-worker/src/luacompat.rs`.

A line that moves for a manifest that already shipped is a bug, never a hash to record again. To change the bytes on purpose:

1. Move `WRITER` up by one.
2. Keep the old behaviour for the older writers, and put the new one behind a check of the manifest's writer. The checks are functions beside `WRITER`, one per change, so each writer's behaviour is listed in one place.
3. Add a manifest that names the new writer.
4. Add the new manifest's golden line, and the new writer's hash where a worker test keeps one per writer. Every older line stays the same.

The 3do converter follows the same rule. A manifest's `converter` records the `coilbox-3do-convert` version it was made with, but coilbox does not check that version when it builds, so raising the crate's version leaves every manifest buildable. A change to what the converter writes for a model or a sheet is a writer change like any other. Keep the old output for the older writers by passing the writer down to the converter, and put the new output behind a check beside `WRITER`. Two more golden tests fail when the converter's output moves, `a_fixed_conversion_writes_the_same_bytes` and `the_sheet_png_is_the_same_bytes` in `crates/coilbox-3do-convert/src/lib.rs`.

The test `the_lua_tests_load_the_preludes_this_crate_builds` checks the preludes for manifest 2 that the Lua tests load from `lua/compat/tests/fixtures/`. After a deliberate change to how a prelude is built, run it with `COILBOX_WRITE_FIXTURE=1` to write them again.

## Run the tests

- `cargo test -p coilbox-compat` checks the registry: every file embedded, every header, the hashes and the manifests.
- `cargo test -p tauri-plugin-coilbox-compat` checks the folder, the def fixes and the golden build.
- `cargo test -p coilbox-unitsync-worker` runs the worker's two golden tests.
- `scripts/mission-tests.sh` runs the Lua tests, with `luajit` on `PATH`.

Some tests need a real game and are skipped in a normal run. `cargo nextest run -p tauri-plugin-coilbox-compat --run-ignored only` needs `xta-9.65.sd7` in `~/.spring/games` or `COILBOX_COMPAT_GAME` naming another game, an installed engine with libunitsync, and a built `coilbox-unitsync-worker` in `target/debug`. `cargo nextest run -p coilbox-compat --run-ignored only` needs Expand and Exterminate 0.46 in `~/.spring/games`, or `COILBOX_COMPAT_EE` naming its `.sdz`.
