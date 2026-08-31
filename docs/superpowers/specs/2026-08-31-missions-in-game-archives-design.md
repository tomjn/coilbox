# Missions inside a game's own archive

2026-08-31. Approved design for [issue #2160](https://github.com/tomjn/coilbox/issues/2160).

A game can already bundle coilbox's mission runtime, which is what lets it play a scenario itself instead of through the generated test mutator. It cannot bundle the missions. Coilbox compiles a scenario to `missions/<folder>/mission.lua` and writes that file into the game folder on every launch, so `scenarioRoute` checks for a loose `.sdd` before it looks at the runtime version at all (`src/scenario/launch.ts:96`). A game shipped as a packaged `.sd7` or `.sdz` therefore falls back to the mutator however complete its runtime is, and the mutator cannot carry the two adoption guards, so the game's own end conditions and opening phases run over the top of content that was meant to be finished.

This design lets a game ship missions in its own archive, packaged or loose, and lets an author edit the ones in a loose `.sdd` in place.

A campaign shipped inside a game is [issue #2161](https://github.com/tomjn/coilbox/issues/2161) and is out of scope here.

## Decisions

- A game ships both the compiled `mission.lua` and the `scenario.json` document. The Lua is what plays, the document is what the editor opens.
- The compiled file always plays, so a player is never blocked by an author's mistake. A loose game recompiles from the document and corrects itself. A packaged game plays what it ships and tells an author the document no longer matches.
- A mission in a loose `.sdd` is editable in place, because an `.sdd` is a development format. One in a packaged archive is read-only, because a packaged archive cannot be written into.
- Every scenario is created and imported locally. Nothing infers a home from the game named in the setup. Putting a mission into a game is a separate, deliberate action.
- The folder name and the document id are different strings. The folder is what the author names and what `coilbox_mission` carries. The document keeps its UUID.
- Dialogue media is read from the archive rather than copied out, held in memory for the session.
- Discovery happens with the games list, not on demand, cached against the archive.

## What a game ships

```
missions/<folder>/mission.lua      the compiled mission, what the engine plays
missions/<folder>/scenario.json    the document, what the editor opens
missions/<folder>/*.png, *.ogg     dialogue portraits and voice clips
```

`<folder>` is the game's own name for the mission. A folder counts as a mission when it holds `mission.lua`. The document beside it is what makes the mission editable and nameable in a list. A folder with only the compiled file is playable and not editable.

`isScenarioId` (`src/scenario/missions.ts:25`) already reads a UUID folder as coilbox's own test leftover and a readable name as the game's content. Keeping the folder name off the document id is what preserves that: a mission moved into a game gets a readable folder, so Content > Games never offers to delete a game's real content as a stray.

## Where a scenario comes from

`LoadedScenario` gains a third source, so a game's mission is an ordinary scenario rather than a parallel concept:

```ts
source: "local" | "bundled" | "game"
origin?: { gameName: string; archivePath: string; folder: string; loose: boolean }
```

`loose` is the `.sdd` test and it is the only thing that decides whether the editor may write. Local is editable, bundled is read-only, a game's mission is editable when `loose` and it ships a document.

Discovery does not belong in the `coilbox-scenario` plugin, which knows nothing about games. A new module reads missions out of installed games and returns `LoadedScenario` values, and `listScenarios` (`src/scenario/storage.ts:58`) merges them with what the plugin stores. The Scenarios list gains a source, not a special case, and the sort stays one sort.

## Reading a game's missions

One reader in the `coilbox-scenario` plugin with three backends behind a single shape: list the mission folders, read one file out of one.

- `.sdd`: the filesystem.
- `.sdz`: the `zip` crate, already a dependency of `tauri-plugin-coilbox-content` and `tauri-plugin-coilbox-mapconv`. `savegame.rs:129` is the pattern.
- `.sd7`: `sevenz-rust2`, already a dependency of the same two crates.

No unitsync involvement, so listing a game's missions does not need an installed engine.

Two new commands, each needing its `build.rs` COMMANDS entry and a `permissions/default.toml` line:

```
scenario_game_missions(root)            -> [{ folder, hasDocument, hasCompiled }]
scenario_game_mission_file(root, folder, file) -> bytes
```

Read when the games list changes. A mission appears because the game is installed, which is the point.

Caching differs by kind, because a folder's modified time does not change when a file nested inside it does. A packaged archive is one file, so its path, size and modified time identify its contents and the mission list is cached against them. A loose `.sdd` is re-read, which is a directory listing and a few small files, and is what makes an edit show up without anything being invalidated.

A `.sd7` is usually solid LZMA, so pulling one small member can mean decompressing a large block. That is fine once at launch and not fine per portrait redraw, so extracted media is held in memory for the session and dropped on exit. Nothing is written outside the archive.

## The launch route

`scenarioRoute`'s `isSdd` check is really "can I write?", standing in for "will the mission be there?". It becomes the second question:

```ts
scenarioRoute({ game, installed, required, reader, missionInGame })
```

- runtime new enough, mission already in the game: adopted, write nothing, packaged or loose.
- runtime new enough, mission not in the game, game loose: adopted, write it, as today.
- anything else: the mutator.

So a packaged game reaches the adopted route for the first time, on the one condition that it brought the mission with it.

The mutator stops writing a mission it does not need to write. A game shipping a mission but no runtime still plays through the mutator, and the mutator copies the mission across as bytes rather than compiling it, because a packaged game may ship `mission.lua` with no document.

Validation stays on every launch and keeps its rule that nothing launches unvalidated. For an archived mission the bytes come from the archive reader and go through `SpringLua::eval_value` (`crates/coilbox-springlua/src/lib.rs:88`) rather than `include_value`, which works because a compiled mission is a single `return { ... }` with no includes. Same validator, same messages, different way in.

## Editing in place

Editing routes on `origin.loose` and nowhere else. A mission that ships only `mission.lua` is not editable, and the editor says so rather than reconstructing a document out of compiled Lua, which would be a guess dressed as a source.

Saves go through the funnel the editor already uses, dispatching on source: local goes to coilbox's store, a game's mission goes to `missions/<folder>/scenario.json` inside that game, with `mission.lua` recompiled beside it in the same operation. `saveScenario`'s stamping stays, because a game's document wants `updatedAt` and a recomputed `runtimeVersion` for the same reasons a local one does.

The write is fenced the way the mutator's is. Loose only, under `missions/<folder>/` only, and the folder has to be the one the document was read from. Nothing else in a game is ever written and no game file is ever deleted.

## Drift

Coilbox compiles the document in memory and compares it to the shipped `mission.lua`. That is a byte comparison, because the compiler is deterministic: array order is document order, author-keyed tables are emitted in sorted key order.

- Loose and different: the recompiled file is written before launch, so it corrects itself and the author never sees a stale mission.
- Packaged and different: the shipped Lua plays, and an author opening the mission is told the document no longer matches what ships. A player is told nothing, because there is nothing they can do.

## Putting a mission into a game

Creation never chooses. New scenario and Import both write to coilbox's store. Nothing infers a home from the game named in the setup, because a player with a loose copy of a game would otherwise have their own scenario silently written into somebody else's game folder.

One action in the editor's Setup card, "Put this mission in the game", enabled when the setup's game is a loose `.sdd` carrying the runtime and advanced mode is on. It asks for a folder name, defaulting to a slug of the scenario's name, writes the document and the compiled mission into `missions/<folder>/`, and removes the local copy. It is a move rather than a copy, so a document has one home and there is no pair to drift.

"Take it out of the game" is the reverse, putting the document back in coilbox's store and clearing the game's folder. Without it, putting a mission in is a one-way door.

## Id collisions

A game's mission and a local scenario can share a document id only through a real UUID collision, since a game's folder is a readable name and the document inside keeps whatever id it was created with. A game's mission plays on its own route because that is what its archive holds. Nothing further is built for this.

## UI

Three places, all reusing what bundled scenarios established:

- **Play > Scenarios** lists a game's missions with the rest, badged with the game they came from rather than "Bundled". The sidebar item's existing rule, hidden until something is playable, counts them.
- **Scenario Builder** lists them too, with Edit live only when the game is loose and ships a document. The read-only case takes the path bundled scenarios take: opening the editor route says why instead of opening the editor. Share still works, so anyone can take a copy of a game's mission and make it their own.
- **Content > Games**, under the Mission runtime section, lists the missions that game ships, with each name read out of its document.

`wording.ts` gains the sentences for the new route and keeps the author and player split it already enforces. The player's is "this mission comes with SplinterFaction". Nothing about archives.

## Testing

- Route table for `scenarioRoute` with the new flag, including the case the issue exists for: packaged game, runtime present, mission present, expect adopted and no write.
- Archive reader per backend, against fixtures built in the test where the crate can write one and checked in where it cannot.
- The write fence: a path outside `missions/<folder>/`, a packaged game, and a folder that does not match all refuse.
- Editability as a table: local, bundled, game loose with document, game loose without, game packaged.
- Drift: identical compiles compare equal, a changed document does not, and a loose game is rewritten before launch.
- Moving a mission in and back out: the local copy goes, the folder is readable rather than a UUID, and the reverse restores it.

The proof that settles it is a headless run of a packaged game playing its own mission, in the shape of the existing `scripts/mission-sf-*.sh` proofs. It needs a `.sd7` of Splinter Faction built with the runtime, the guards and a mission inside, and it is expected to be run by hand rather than in CI, which is where those proofs already sit.
