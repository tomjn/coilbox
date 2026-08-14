# Milestone 22: A base you built once, placed anywhere

https://github.com/tomjn/coilbox/milestone/22

Started at 7 issues. The design work on 2026-08-12 added five and moved the in game widget out to its own milestone, and agents have filed four more as they went. 72 pieces of work now, 50 done, 25 of them here and 1 in the hub repo. Agents keep finding real work, which is why the number climbs.

Base branch: `main`.

Commands, read from `package.json` and `CLAUDE.md`:

- test: `bun run test` (vitest)
- lint: `bunx biome ci .` and `bun run typecheck`
- rust: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`
- app: `bun tauri dev` (vite on port 1430)
- sidecar: `bun run sidecar:unitsync` after touching the unitsync worker

## Done

- https://github.com/tomjn/coilbox/issues/1312 : BAR's blueprint file, merged as https://github.com/tomjn/coilbox/pull/1433. A Base blueprints panel on the scenario editor page reads a game's file in as bases and merges one back out. Merge safety lives in `src/blueprint/gameFile.ts` so it holds whether or not the panel remembered to ask: it refuses while a game is running, copies the file before every write, never writes over a file it could not read, and carries entries it does not understand through untouched. An export names the mission-only fields it would strip, counted, next to the button that would strip them. Not verified in the app: the panel, the dialogs and the file read and write over the Tauri bridge.
- https://github.com/tomjn/coilbox/issues/1423 : naming bases, merged as https://github.com/tomjn/coilbox/pull/1432. A base is called after the layout it places, and only gets a number when another base places the same layout. Triggers address bases by stable id rather than by the label, so nothing saved changes meaning.
- https://github.com/tomjn/coilbox/issues/1310 : the model split, merged as https://github.com/tomjn/coilbox/pull/1413. A scenario now holds `blueprints` (the reusable geometry) and `bases` (the placement, carrying team, origin, trigger id, factory queue and repeat). Document schema goes to 2 with a read migration for schema 1 files. The compiled `mission.lua` contract is deliberately unchanged, because games vendor that runtime and a copy shipped a year ago still reads `prefabs`, so `compileScenario` resolves blueprint and base back together on the way out. The golden compiled fixtures under `src/scenario/fixtures/missions/` are byte-identical, which is the proof. `MISSION_SCHEMA_VERSION` is now its own constant, separate from the document version, so raising the document version cannot make every vendored runtime refuse every mission. `SCENARIO_KIND_VERSION` goes to 2 only when a document actually holds a base.
- https://github.com/tomjn/coilbox/issues/1429 : the map's help line, merged as https://github.com/tomjn/coilbox/pull/1430. It now sits in a footer strip under the 3D view instead of floating over it. The strip stays in Expand mode too, on the argument that expanding is for detail work so covering terrain there is worse rather than better. Verified by measuring the canvas and strip rectangles in both modes, not by eye, because the canvas captures black.
- https://github.com/tomjn/coilbox/issues/1418 : the build order, merged as https://github.com/tomjn/coilbox/pull/1425. `BaseBlueprint.ordered` is optional and written only when on, so a layout nobody sequenced carries nothing. A Build order popover holds the switch and the numbered list, "Watch it go up" plays the base one building at a time over the map without touching the document, and "Copy as a build order" writes the sequence of unit names. Reordering goes through `LayoutEdit`, so it copies a shared layout rather than writing through.
- https://github.com/tomjn/coilbox/issues/1421 : the model drawn apart from its footprint, merged as https://github.com/tomjn/coilbox/pull/1426. Display only. `scenarioPlacements` puts buildings on the snapped point using the same `buildGridSnap` the footprint squares use, and the document is untouched. The agent never needed `ScenarioMapScene.tsx`, which is why it did not collide with the build order work running beside it.
- https://github.com/tomjn/coilbox/issues/1414 : sharing and naming, merged as https://github.com/tomjn/coilbox/pull/1422. Copy on write. Editing through a base that shares its layout gives that base its own copy and leaves the others alone, because the worst case there is one undo, where writing through silently damages a base nobody was looking at. Writing through is still reachable on purpose, as a switch in the base's buildings popover held against the base it was turned on for. Layouts now have names a person sets, and existing ones named after their own id read as "Layout 1", "Layout 2" and so on. A read migration, no version bump, because an older build finds a name where it expected one.
- https://github.com/tomjn/coilbox/issues/1311 : footprints, merged as https://github.com/tomjn/coilbox/pull/1420. `footprintx` and `footprintz` reach the frontend from the unitsync dataset, the editor draws the real footprint, placement snaps to the build grid, and an overlap is marked. Verified against Balanced Annihilation V15.9.8, with armcom 2x2 through armlab 6x6. Both hard cases are covered by tests: sides swap on an odd facing, and an odd footprint centres in the middle of a build square rather than on a corner.

- https://github.com/tomjn/coilbox/issues/1417 : the blueprint container kind, merged as https://github.com/tomjn/coilbox/pull/1437. `blueprint` is a seventh kind at version 1, with `src/blueprint/payload.ts` as the wire shape and `transfer.ts` encoding it. Footprints ride in the payload as a dictionary keyed by unit def, because a footprint is a fact about the unit rather than the placement, so twenty solars state it once and two entries cannot contradict each other. `payload.ts` deliberately stands alone, importing only `gameIdentity.ts` and restating the build square in elmos, so the hub can vendor it without pulling in the app. Measured rather than assumed: a 400 building layout is a share code under 8,000 characters against a 512 KB ceiling.

- https://github.com/tomjn/coilbox/issues/1416 : the editor lift, merged as https://github.com/tomjn/coilbox/pull/1440. `src/placement/` now holds the shared surface, and `GridScene` gives it flat ground with the engine's build grid on it, 4096 elmos square, reading nothing off disk. Both grounds hand over to the same `MapScene3D`, so unit models, footprint squares, the selection ring and pointer arithmetic are one implementation used twice rather than two that drift. The decision worth knowing: the standalone editor holds a layout as a scenario with exactly one base placed from it, which is what lets the existing drag, turn, delete and reorder rules be shared instead of reimplemented. The Base blueprints panel from 1312 was confirmed rendering in the app at the same time.

- https://github.com/tomjn/coilbox-hub/issues/84 : the hub side, merged as https://github.com/tomjn/coilbox-hub/pull/86, and the migration is applied to production. `blueprint` is in `GALLERY_KINDS`, `payload.ts` is vendored as a new sync group, and `lib/gallery/blueprintPreview.ts` draws a layout as rounded squares sized by footprint. A def missing from the footprint dictionary falls back to one build square, which is what the engine floors every footprint to, so an odd payload draws the right shape with some squares undersized rather than drawing nothing. Verified live: `kind=blueprint` returns 200 with an empty list, `kind=preset` returns real data, `kind=nonsense` still returns 400.

- https://github.com/tomjn/coilbox/issues/1436 : checking an import against the game, merged as https://github.com/tomjn/coilbox/pull/1443. A layout naming no units this game has says so and its button reads "Add it anyway"; a layout with one unknown unit among four says which one and that the other three are fine; nothing is blocked either way. With no unit dataset read yet the check does not run, and `ImportReport.checked` is false so an empty list of missing units cannot be mistaken for a clean result.

- https://github.com/tomjn/coilbox/issues/1441 : the machinery move, merged as https://github.com/tomjn/coilbox/pull/1446. The test it was set was whether the library could be written without importing from `src/scenario/`, and the answer is yes: it needs `BaseBlueprint` from `@/blueprint/model` and `BlueprintEditor` from `@/placement/BlueprintEditor`, and no scenario type leaks through that surface. What stayed behind is what takes a scenario and returns one, because moving that would have put teams, groups and origins into a shared module, which is the thing the move existed to stop. `useGameUnits` went to `src/content/` rather than `src/placement/`, since four of its six callers are pickers with nothing to place.
- https://github.com/tomjn/coilbox/issues/1438 : the app's blueprint preview, merged as https://github.com/tomjn/coilbox/pull/1448. Same arithmetic and same visual constants as the website, deliberately, so a layout does not read one way there and another way here. It differs on colour only, using theme tokens instead of the site's fixed dark neutrals, because coilbox has a light theme. The agent rendered it to static markup and screenshotted it rather than claiming it looked right.

- https://github.com/tomjn/coilbox/issues/1424 : keeping unplaced layouts, merged as https://github.com/tomjn/coilbox/pull/1449. `pruneBlueprints` is gone. A layout now leaves a scenario only when an author deletes it from the contents list or empties it of buildings, and a layout two bases share cannot be deleted at all until nothing places it, so nobody loses a base across the map by deleting geometry they thought was used once. Unplaced layouts appear in a "Not placed" section of the Contents popover. Undo is safe because history is whole-document snapshots, so restoring a base cannot produce a second copy of its layout.

- https://github.com/tomjn/coilbox/issues/1415 : the blueprints library, merged as https://github.com/tomjn/coilbox/pull/1451. **This is the screen to open first.** Content > Blueprints in the sidebar. New blueprint asks for a name and which game's units it is drawn from, then drops you on a full page with the editor: place, drag, turn, delete, set a build order, watch it play back. Edits save about a second after the last one and again on leaving. Cards carry a drawn thumbnail using the hub's own arithmetic, the building count, a build order marker and the game, and filter by game once you have more than one. Nothing imported from `src/scenario/`, which is what the previous two issues existed to make possible. Store is `crates/tauri-plugin-coilbox-content/src/blueprints.rs`. One real blueprint, "Opening solars" for Balanced Annihilation, is already in the library.

- https://github.com/tomjn/coilbox/issues/1442 : undo in the standalone editor, merged as https://github.com/tomjn/coilbox/pull/1453. The scenario editor's history was made generic over its document type rather than a second one being written, so both editors share the snapshots, the 100 step cap and the branch-on-edit-after-undo rule. A drag is one step, because the pointer layer moves the drawn objects during the gesture and calls `onMove` once on release. `BlueprintEditor` gained one optional prop, `history?: "own" | "caller"`, so the library page got undo without changing a line and the scenario panel opts out to avoid two key listeners taking two steps on one press.

- https://github.com/tomjn/coilbox/issues/1439 and https://github.com/tomjn/coilbox/issues/1444 : sharing, merged as https://github.com/tomjn/coilbox/pull/1455. Share sits on the detail page and opens a drawer with a code, a `coilbox://` link, a file and hub publish, reusing the same view the other four kinds use. Import sits beside New blueprint on the list and is where a blueprint deep link lands. What travels is the stored payload rather than a fresh export, because re-deriving it would need a unitsync read the sharer may not be able to do for a game they have since removed. Nothing refuses an arriving layout: a warning changes the button's words, not its existence. It also fixed a real bug found only by driving the app, where `useHubItemPresence` fell through to presets for any kind it did not name, so a published blueprint read as imported whenever an unrelated preset id matched.

- https://github.com/tomjn/coilbox/issues/1315 : the terrain check, merged as https://github.com/tomjn/coilbox/pull/1461. The rule is the engine's own, read out of RecoilEngine's C++ rather than inferred: `maxHeightDif = 40 * tan(maxSlope)` per unit, the building takes one levelled height from the four heightmap corners around its middle, and every square the footprint covers must be within tolerance of that one height. So it is not a gradient and not "the ground is not flat", and a building half on a step fails on the level half too. The agent mutation-tested the rule twice, dropping the slack term and ignoring the facing, and confirmed each mutation fails a distinct test. `BaseBlueprint.designedFor` records the map a layout was drawn on and shows as "Drawn for X" when a base stands somewhere else. Three gaps are silent rather than wrong and are filed: maps 8192 elmos and wider get no verdict, and water depth and floaters are skipped.

- https://github.com/tomjn/coilbox/issues/1327 and https://github.com/tomjn/coilbox/issues/1450 : the join, merged as https://github.com/tomjn/coilbox/pull/1462. **This is what the milestone was for.** Out of a mission: "Save to your library" on any layout in the Base blueprints panel. Into a mission: a new Layouts mode, pick a layout and a team, click the map, and placing a library layout copies it into the document so a second click is one shape in two places. Within a mission: the "Not placed" row has a pin that arms the layout for the next click, rather than dropping it at a fixed point, because where it stands is why the author deleted it. Nothing is refused except an empty layout. The agent also found and fixed two real things while driving it: the arrival check skipped the unit test whenever a layout claimed a different game, and `designedFor` was missing from the shared payload, which this PR would have been the first thing to drop.
- https://github.com/tomjn/coilbox/issues/1458 : closed by the above, `designedFor` is on the payload.

- https://github.com/tomjn/coilbox-hub/issues/85 : the blueprint backdrop, merged as https://github.com/tomjn/coilbox-hub/pull/87. Drawn from the kind's structure rather than the item's own layout, because every other kind's backdrop is per kind and drawing the real layout would have put a second copy of the preview behind the first. Kept off the preview by weight rather than subject: outlines at 0.12 strength behind solid squares at page contrast. The agent built the real Tailwind CSS, rendered the actual components to static markup, screenshotted at two sizes, and changed two things because of what it saw. It also picked up the `designedFor` vendor bump as its own commit and confirmed nothing else moved.

- https://github.com/tomjn/coilbox/issues/1314 : side substitution, merged as https://github.com/tomjn/coilbox/pull/1465. The mapping comes from the person, one unit type at a time, and `planForSide` fills in candidates where the game's own naming allows: the sides' start units share a suffix, so `armsolar` suggests `corsolar`. Every candidate is checked against the game's units first, so a coincidental shared ending yields nothing rather than units nobody has. A game with no derivable mapping still gets the rows, unfilled, and keeps spacing, facings and build order, which beats redrawing. Every substitution is re-snapped and re-checked, so an overlap is found on the post-swap positions rather than the file's numbers, and a substitute that changes footprint is reported as having moved things. `originalName` travels through the container, BAR's format and the scenario document, so an export round trips.

- https://github.com/tomjn/coilbox/issues/1456 : the keychain hang, merged as https://github.com/tomjn/coilbox/pull/1471. After ten seconds the form says coilbox could not read the keychain in time and offers Try again, rather than spinning forever. A check that failed is now its own state rather than being reported as signed out, so nobody is offered a sign-in on the strength of a question that was never answered. The threading change was forced rather than chosen: a blocking OS call inside an async command never yields, so a timeout around it does nothing at all, and `spawn_blocking` is what makes a deadline possible. The abandoned read runs on and fills the credential cache, so a prompt answered late spares the next caller. Proved by falsification, removing the timeout made the test hang and get killed at exit 124, and live in the app at 10,004 ms against a genuinely blocked keychain.

- https://github.com/tomjn/coilbox/issues/1313 : packs, merged as https://github.com/tomjn/coilbox/pull/1472. **All seven issues the milestone opened with are now closed.** Open a pack, pick the game to read it against, and the line under it says how many of the thirty can be placed in it, which is the fastest way to work out what a pack is for. Rows sort fits-first and never move as you tick, the useless ones hide in bulk, and names thread through the ticked ones in order so unticking one frees its name for the next. Provenance is on the library record rather than the payload, deliberately: it is a fact about your copy, so no path off your disk travels to anyone when you share it on.
- https://github.com/tomjn/coilbox/issues/1454 and https://github.com/tomjn/coilbox/issues/1452 : merged as https://github.com/tomjn/coilbox/pull/1475. The duplicate name field is gone, so one name goes one route through history and undo no longer reverts a rename. The agent checked the alternative first and rejected it for costing two new props and a duplicate control. Duplicating a layout counts the name up and deep-copies the payload, so editing the copy cannot reach the original.

- https://github.com/tomjn/coilbox/issues/1435 and https://github.com/tomjn/coilbox/issues/1427 : merged as https://github.com/tomjn/coilbox/pull/1478. The picker now opens on the engine's own `LuaUI/Config/blueprints.json`, built from the path unitsync reports, and nothing is probed on disk because Tauri's `set_default_path` fills in the name even where no file exists yet. Off-grid layouts now say so: "This layout's numbers do not agree with the build grid... Nothing has been changed", with an offer to put it on the grid that routes through `editBaseLayout`, so it copies a shared layout rather than moving every base placed from it. The comparison was new, because the import kept its snap report but a layout already in a document dropped the original.

- https://github.com/tomjn/coilbox/issues/1464 and https://github.com/tomjn/coilbox/issues/1463 : merged as https://github.com/tomjn/coilbox/pull/1481. A layout now follows the pointer as the squares it would stand on, snapped exactly as the click would snap it, carrying the same red and amber marks a placed base gets, plus a line in words because a colour alone is not something you can act on. Cost was measured rather than assumed: 0.013 ms synchronous per pointer move, redraw only when the snapped origin changes, frame cadence unchanged at the vsync floor. A layout whose def the game has not got now records no footprint instead of a wrong one build square, so the guess stays at the point of drawing where it belongs rather than being baked into stored data that travels to other people.
- https://github.com/tomjn/coilbox/issues/1476 and https://github.com/tomjn/coilbox/issues/1477 : merged as https://github.com/tomjn/coilbox/pull/1485. A card menu carries Rename and Duplicate. The card was rebuilt so the menu never sits inside the anchor, with the name as the link and a stretched pseudo-element covering the card, so a menu button inside a link does not fight it. Renaming from a card cannot recreate the earlier undo bug, because a layout on a card is closed and no editor history is holding it.

- https://github.com/tomjn/coilbox/issues/1483 and https://github.com/tomjn/coilbox/issues/1460 : the terrain check repaired, merged as https://github.com/tomjn/coilbox/pull/1489. It had been dead since it shipped: the editor handed it the worker's render, capped at 1024 a side, where the engine's rule needs the map's own corner grid, 1537 wide on Bismuth Valley, so every verdict was "unknown". The tests never caught it because they hand the function a field of the right size. The agent tried to bound the error from a downscaled field and could not, and measured why: 117 of 5673 sample positions disagreed, worst corner 192 elmos out against a 7 elmo tolerance, because a box-downscaled height averages over whatever cliff is in the block. So it asks for a bigger render instead and the tolerance cost is zero. Verified on a real map: 8 of 31 buildings marked amber where ground moves 30 to 33 elmos across a footprint, and buildings on ground moving 11 elmos left alone.
- https://github.com/tomjn/coilbox/issues/1473 and https://github.com/tomjn/coilbox/issues/1474 : merged as https://github.com/tomjn/coilbox/pull/1486. Provenance now covers five arrival routes, and a share code honestly records nothing but a timestamp rather than inventing something. It still never enters the payload, so no path off your disk travels to a stranger. Writing several layouts reuses the single write's safety: one backup, one refusal check, one write, all four land or none do.

- https://github.com/tomjn/coilbox/issues/1467 and https://github.com/tomjn/coilbox/issues/1466 : side conversion widened, merged as https://github.com/tomjn/coilbox/pull/1494. The finding worth keeping: there is no side mismatch to detect, because in BAR both sides ship in one game, so an Armada layout has every unit a Cortex player has and the missing-units check passes correctly. The new reading asks whose buildings a layout names, from the game's sides rather than its unit list, and answers only when the whole question can be answered. Where the side cannot be told, the screen says nothing about sides at all, because a warning there would be a claim about the person rather than the layout. Converting one base routes through `editBaseLayout`, so a shared layout is copied rather than every base sharing it being changed.

- https://github.com/tomjn/coilbox/issues/1491 and https://github.com/tomjn/coilbox/issues/1445 : three states, merged as https://github.com/tomjn/coilbox/pull/1495. This is the fix for how the terrain check rotted unnoticed. A building is now told apart by shape rather than colour: a quiet filled square passes, a bold filled one fails, and an empty dashed ring has no verdict. The words say which reason, because "unknown" alone is not actionable: the game's units are unread, or this map's heights could not be read, or the game gives that unit no slope to check against. A unit this game has not got is violet and is a refusal rather than an unknown. A loading session stays quiet because the sentences wait for the dataset to settle. All three states were forced and seen in the app, including by making the heightmap decode fail on purpose.

- https://github.com/tomjn/coilbox/issues/1480 and https://github.com/tomjn/coilbox/issues/1469 : merged as https://github.com/tomjn/coilbox/pull/1499. Writing a layout now creates at most two missing directory levels, exactly `LuaUI/Config`, and refuses anything deeper with a message naming the shallowest missing directory, so a mistyped engine path does not silently build a tree somewhere wrong. Keychain writes got the same deadline the reads got, with different wording on purpose: a write that timed out may still land, so a sign out says whether the saved copy is gone is not known rather than claiming you are signed out. Both fixes were falsified, and both mutations were caught.
- https://github.com/tomjn/coilbox/issues/1493 and https://github.com/tomjn/coilbox/issues/1488 : merged as https://github.com/tomjn/coilbox/pull/1500. Factory queues now convert with their layout, and the honest finding is that the prefix derivation rarely lands for units: TA-line games name buildings for what they do, so `armsolar` becomes `corsolar`, but name units for what they are, so `armpw`'s opposite is `corak` and no prefix swap reaches it. Where it does not land, nothing is suggested and a warning names every order left stranded on the wrong side. The running-game refusal narrowed to writes that actually land under the engine's config directory, with every undecidable case reading as the game's own file.

- https://github.com/tomjn/coilbox/issues/1503 : the welcome screen illustration, merged as https://github.com/tomjn/coilbox/pull/1504. Asked for by Tom directly. `content.blueprints` was missing from the `DRAWINGS` registry, so the library card fell back to procedural art beside neighbours that had real drawings. It draws a base on a build grid, threaded in the order it goes up, ending on one plot still an empty dashed outline. It stays distinct from `content.maps` by stopping the grid short of all four edges, so it reads as a sheet rather than as ground. The agent changed it twice after looking at it on the real screen: the first layout read as an arrangement of boxes rather than a base, and the order thread was invisible along the top edge.

- https://github.com/tomjn/coilbox/issues/1506 : the preview redrawn, merged as https://github.com/tomjn/coilbox/pull/1507 and https://github.com/tomjn/coilbox-hub/pull/89. Asked for by Tom, who noticed the decorative illustration looked better than the real thing it decorates. A layout now draws as a plan on a sheet: the build grid, one clear build square of margin on every side, tinted rounded buildings under a stronger outline, and the build order as a dashed thread with a solid dot on the building it starts from. The grid pitch is one build square up to 16 across, then doubles, and rules always fall on real build square boundaries, so it is the build grid at a stated resolution rather than decoration. Strokes are pixels rather than build squares, so a hairline stays a hairline at any layout size. Two things came only from looking: the grid competed with the buildings until its opacity dropped, and a 31 stop order thread was a scribble at page size until it moved under the buildings and faded with stop count. A building the payload never sized draws unfilled and dashed, so the one square fallback cannot pass for a measurement.

## Storage, settled 2026-08-13

BAR's `LuaUI/Config/blueprints.json` is an import and export target only. Coilbox keeps its own storage for everything else and never treats that file as its library.

Why it could not be the library, from reading the game's widget: the path is a fixed constant with no game name in it, and the engine resolves it against the write directory, which is per data dir rather than per game. One file therefore holds every game's layouts in one flat list, with no field saying which game an entry is for. The widget is not destructive about this, since it writes entries it cannot read straight back on save, but it cannot tell two games apart either.

## Design

`docs/superpowers/specs/2026-08-12-base-blueprints-design.md`, written 2026-08-12 from your decisions. It settles the surfaces so twelve agents do not each invent one: a `content/blueprints` library with a full page detail view, a shared placement editor that draws on a grid and needs no map, sharing through the Coilbox hub as a seventh container kind, an optional build order held as the buildings array's own order, and a hub preview of rounded squares because the hub has no unit pictures.

Two decisions moved work out of this milestone. The in game widget became milestone 26, https://github.com/tomjn/coilbox/milestone/26, sequenced after milestone 20 which builds the widget install infrastructure it rides on. The hub side became https://github.com/tomjn/coilbox-hub/issues/84 in the other repo.

## The original scope is complete

The seven issues this milestone was written around, 1310 through 1315 and 1327, are all closed as of 2026-08-13. A blueprint is a real object with a library, an editor that needs no map, footprints, a build order, sharing through the hub, BAR's format in both directions, side conversion, a terrain check and the join to missions in both directions.

Everything below is follow-up work agents found while building that. It is all genuinely useful and none of it is load bearing. This is the natural point to stop if the remainder is not wanted.

## Finished, 2026-08-13

Milestone 22 is complete: 100 issues closed, 0 open. It opened with 7.

The milestone itself is still open on GitHub, deliberately, because closing it is Tom's call rather than mine.

## Second session, 2026-08-13 afternoon

The run continued after Tom woke. Milestone 22 is now 86 closed with 8 open, from 47 closed when the overnight session ended.

What landed since: the plan drawing redone twice on Tom's feedback, dragging a building showing its real footprint, two genuine bugs that found (a drag landing half a build square off, and the selection ring never coming back after an edit), the terrain check made exact by reading raw 16-bit heights, the water rule, a bounded height cache, the per game equivalence table with provenance and search, and the placement nudge.

Tom also pruned the milestone. Issues agents filed because they tripped over something while building blueprints, rather than because blueprints caused them, do not belong here. 1498, 1447, 1501, 1520 and 1521 were removed on that test. Apply it when filing.

## Where the overnight session stopped, and what to do first

Stopped at 47 of 68, with 17 issues open. The milestone's own seven are all closed, and so are every defect found along the way. What is left is enhancements, all filed and described, none load bearing.

Open the app, which is running on port 1430, and go to Content then Blueprints. There is one real layout there, "Opening solars" for Balanced Annihilation, left deliberately so there is something to look at.

Four things worth trying, in the order they build on each other:

1. Make a blueprint. It opens on a grid with no map, which is the point: a layout is not made for one map, and map loading is the slowest thing in coilbox. Place, drag, turn, set a build order, watch it play back, undo any of it.
2. Open a scenario, switch to Layouts mode, and hover the map. The layout follows the pointer as the squares it will actually stand on, marked before you click rather than after.
3. In the Base blueprints panel, open a game's `blueprints.json`. It starts in the right directory. Anything it cannot place here says so in words before you take it.
4. Share a layout, then import it back. It lands as "Opening solars 2" and tells you where it came from.

## Hub publish, confirmed working 2026-08-13

Tom answered the keychain dialog and the whole chain now works, verified in the running app rather than reasoned about:

- The keychain read returns in 19 ms, having been blocked since 02:12.
- The hub page reads "Signed in as tomjn", so the sign-in check resolves rather than spinning.
- The Blueprints filter returns a clean empty list, "Nothing on the hub matches those filters yet", instead of the 400 it would have given before the service carried the kind.
- The Share drawer on a blueprint renders the full publish form, Title, Description, Tags and Publish, with no spinner and no error.

I stopped short of pressing Publish. That would put a public item on the gallery under Tom's name, which is his to do, and the point was to prove the path is reachable rather than to post something.

## Superseded: the one thing needing you

Answer the macOS keychain dialog. A `security find-generic-password` process has been blocked since 02:12. Coilbox no longer hangs on it, but publishing to the hub cannot be tested until it is answered, and no agent clicked it because answering a security dialog on your behalf is not their call.

## What I would look at with a sceptical eye

The terrain check shipped, was mutation tested against the engine's own C++, and then did nothing at all on a real map for hours, because a building it could not judge looked exactly like one it approved of. It is fixed and verified now, and https://github.com/tomjn/coilbox/pull/1495 makes an unjudged building visibly different. But it is the clearest example of what a passing test suite does not tell you, and it is worth checking that the marks you see on a real map match what the engine actually does.

Anything an agent could not verify is stated as unverified in its PR. The pattern across the night: logic is well covered, and surfaces that needed the app were only checked by whichever agent held it.

## Winding down

The follow-ups have been generating follow-ups at roughly the rate they close, which is the signal to stop rather than work the list to zero. The last four items I am taking are the ones that are genuine defects rather than enhancements: 1480 and 1469 in the main checkout, 1493 and 1488 in a worktree.

Everything remaining after those is filed, described, and optional. None of it is load bearing and none of it is a defect.

## To do

All follow-up work now, in rough value order. Each is one sub-agent, one branch, one PR. Two run at once, and only the agent in the main checkout may drive the app.

Worth doing:

1. https://github.com/tomjn/coilbox/issues/1464 : **Running, main checkout.** placing a layout does not put it down where it will fit. The core interaction, so this is the highest value one left.
2. https://github.com/tomjn/coilbox/issues/1463 : a saved layout records a unit the game has not got as one build square, which is wrong data rather than a missing feature.
3. https://github.com/tomjn/coilbox/issues/1434 : an imported layout lands on the map's north-west corner. Now fixable properly, because Layouts mode can arm it for the next click instead.
6. https://github.com/tomjn/coilbox/issues/1445 : a building whose unit the game has not got looks like any other once the layout is taken.
7. https://github.com/tomjn/coilbox/issues/1476 and https://github.com/tomjn/coilbox/issues/1477 : renaming hides behind the buildings count, and copying means opening a layout first. **Running, worktree.**
8. https://github.com/tomjn/coilbox/issues/1480 : sending a layout fails when `LuaUI/Config` does not exist, because the write is a bare `fs::write`. A real failure on a fresh install. Needs Rust, so main checkout.
9. https://github.com/tomjn/coilbox/issues/1479 : only a base on a map gets the off-grid note; the library page and standalone editor need it too.

Smaller or more optional:

9. https://github.com/tomjn/coilbox/issues/1457 : preview a blueprint on a map from the library detail page.
10. https://github.com/tomjn/coilbox/issues/1467 : offer the side conversion where a layout arrives.
11. https://github.com/tomjn/coilbox/issues/1466 : convert a base already placed in a mission.
12. https://github.com/tomjn/coilbox/issues/1473 : provenance is recorded for packs only.
13. https://github.com/tomjn/coilbox/issues/1474 : a pack can be opened but not made.
14. https://github.com/tomjn/coilbox/issues/1469 : signing out can hang on the keychain the way checking did.
15. https://github.com/tomjn/coilbox/issues/1470 : only the publish form offers to check the sign-in again.
16. https://github.com/tomjn/coilbox/issues/1459 : the terrain check says nothing about water.
17. https://github.com/tomjn/coilbox/issues/1460 : the terrain check gives up on maps 8192 elmos and wider.
18. https://github.com/tomjn/coilbox/issues/1431 : reading and writing a file goes through a command named after keymaps. Touches Rust, so main checkout only.
19. https://github.com/tomjn/coilbox/issues/1447 : `Point` and `Facing` are engine geometry living in the scenario model. Cosmetic.
20. https://github.com/tomjn/coilbox/issues/1468 : carry a per game table of equivalent buildings rather than reading unit names.
21. https://github.com/tomjn/coilbox-hub/issues/88 : a blueprint page says nothing about the map it was designed for. Hub repo.

## The hub migration, authorised 2026-08-13

The hub has no real users yet, so Tom authorised applying Supabase migrations to the live database without asking each time, and said not to design around backwards compatibility or migration gaps. There is nobody's data to break, so splitting a schema change into a compatible sequence costs effort and buys nothing.

That authorisation lapses the moment the hub has users. Until then, apply and move on.

Preconditions checked before the first one: the CLI is 2.113.0, already linked to `coilbox-hub` and authenticated to production, and local and remote migrations are exactly in sync at 12 each. So `db push` applies only the new migration, with no accumulated drift riding along behind it.

Done for the first one on 2026-08-13: `20260813010000_item_blueprint_kind.sql`, dry run first, applied before merging the PR, confirmed against the remote migration list and then against the live API.

Order to keep: apply the migration before merging the PR, not after. Widening a check constraint is backwards compatible, and Vercel deploys on merge, so the other order leaves a window where the deployed code accepts publishes the database rejects.

## Decisions taken

Issue 1421 offers two ways to stop a building's model and its footprint being drawn apart, and they are not alternatives. Draw the model on the snapped point, because the editor's job is to show what will happen. Do not snap the positions in the document on load, because quietly editing somebody's file when they open it is not acceptable. Where an import needs the numbers to agree with the grid, that is a deliberate conversion and it belongs to 1312, which can say what it did.

Issue 1424 offers two ways to stop a scenario discarding an unplaced layout, and one of them is architecturally significant: let a base point at a library blueprint outside the document. Take the other one. A scenario carries its layouts inline, including ones nothing currently places, and importing from the library copies into the scenario. The reason is the container model: a scenario is shared as a self-contained payload, so a base pointing out of the document would produce a scenario that works for its author and for nobody they send it to. The cost is that something has to list unplaced layouts and the author has to delete one deliberately, which the contents list can carry.

The milestone description sequences this after the mod workshop (milestone 21) because footprints come from https://github.com/tomjn/coilbox/issues/1269. Milestone 21 has not started, and waiting for all 18 of its issues is not justified. `crates/coilbox-unitsync-worker/src/dataset.rs` already reads unitdefs through the Lua parser and emits a tab-separated line per unit, so adding `footprintx` and `footprintz` to it is a contained change inside issue 1311. Issue 1269's general "every stat" work still stands, and will subsume the two fields later.

## How I am working overnight, 2026-08-13

Tom is away and reviews in the morning. Standing instruction: use judgement, do not be hesitant, git can roll anything back.

So: I take design decisions myself rather than parking them, and write each one into this file with its reasoning. I merge when the tests and CI are green. I apply hub migrations without asking. I do not stop to ask about anything reversible, which is nearly everything here.

What I still would not do without asking: rewrite published history, force push, or anything that reaches people outside this machine and cannot be undone with a revert.

## Worth knowing

Never run git commands in the main checkout while an agent is working there, including ones that look read-only. I ran `git checkout main && git pull` to merge a worktree PR and it aborted on the working agent's uncommitted changes, leaving the checkout on `main` rather than on whatever branch that agent had. Nothing was lost, and I messaged the agent to check its branch before committing, but the failure mode is an agent committing to `main` without noticing. Do worktree merges from the worktree, or from a directory that is not the main checkout.


An agent's `bun tauri dev` dies when its task ends. One agent started the app itself, verified against it, then reported afterwards that the app was gone. Its evidence still stood, but the next agent would have found nothing on port 1430. I restarted it from the orchestrator instead, where it outlives any single agent. If an agent says the app is not running, check before believing the previous agent left it up.


There are local checkouts of the engine and its tools at `/Users/tomjn/dev/RecoilEngine`, `SpringMapConvNG`, `spring-testdata`, `springlobby` and `upspring`. Point agents at those rather than letting them fetch from GitHub. `RecoilEngine` is the ground truth for engine behaviour and reading it beats inferring every time.

I verified the terrain rule against that checkout after a nested research agent said it could not confirm it. All three cited locations matched exactly. The agent's own report was accurate; the helper it spawned had stalled and the agent said so and did the work itself.

Do not remove a worktree until nested agents inside it have finished. I removed one after its parent reported, which killed the Bash tool of a research agent still running inside it. Nothing was lost here, but the failure is silent from the outside.


The unitsync sidecar was rebuilt on 2026-08-13 after the terrain check landed, so `maxSlope` now reaches the frontend. If the terrain check ever reports "unknown" for every building, that binary is stale again: `bun run sidecar:unitsync`.

Changing `src/blueprint/payload.ts` breaks the hub's CI until the hub re-syncs. The hub pins vendored files by their blob SHA on coilbox main and `check:vendor` is what its CI runs, so any change to that file has to be followed by `bun run sync:vendor` in `/Users/tomjn/dev/coilbox-hub` and a commit. This happened on 2026-08-13 when `designedFor` was added, and the agent working in the hub was told to expect it.


This repo can test React components, whatever an agent tells you. `src/hub/pages/components/ItemPreview.test.ts` renders one with `renderToStaticMarkup` and asserts against the markup. One agent reported there was no React test setup and skipped a rendering test on that basis, which was wrong. It is also the way to check a drawing without the app: render to static markup, write it to a file, and look at it with `agent-browser`.


Your local hub development database was wiped. The hub agent found Docker stopped, started Colima to run the migration tests, then hit three unrelated pgTAP failures caused by 12 leftover rows and ran `supabase db reset` to clear them. It dumped the data first. I moved those dumps out of `/tmp`, which does not survive a reboot, and out of the repo, which would have put an auth schema dump holding user records one careless `git add` away from being committed. They are now at `/Users/tomjn/dev/coilbox-hub-db-backup-20260813/`. Colima is stopped again and the docker context is back to `default`.

None of this milestone is in a GitHub release. Releases come from a pushed tag, so `main` is not what anybody runs. Confirmed with Tom on 2026-08-13, and it means a state that is briefly wrong between two merges reaches nobody. Do not spend effort ordering merges to avoid transient breakage, only to avoid real breakage. The one exception already in flight is the hub database migration, which goes in before its PR because that costs nothing.

CI does not run the frontend test suite. `.github/workflows/lint.yml` runs biome, typecheck, `cargo test` and the Lua mission tests, but never `bun run test`. So a green PR says nothing about the 4928 vitest tests, and each agent's own run is the only evidence they pass. I verify by running the suite myself before merging.

Disk: `target/` was 19 GB with only 13 GiB free. Removed `target/debug/incremental`, which cargo regenerates and which the running app does not read, taking it to 13 GB and 18 GiB free. The next Rust build will be slower once.

## Needs from you now

Nothing. The keychain dialog was answered and hub publish is confirmed reachable.
