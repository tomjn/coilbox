# Partial presets: taking only the parts you want

A coilbox preset is a whole setup. It carries the game, the map, the start positions, the mod options, the roster and any unit restrictions, and applying one applies all of it. That is right when you are reloading your own saved battle. It is wrong when somebody shares a preset and you only wanted one thing out of it.

The case that prompted this: you see a shared preset with a map and a start box layout you like, and you want those two in your battle room without losing the teams you have already sorted or the options you have already set. There is no way to do that today. The same problem runs the other way, where somebody wants to share a set of mod options and the only container that carries them also drags a map and a roster along.

This has two halves, and they are worth keeping apart. Letting the receiver pick parts when applying is the half that works on every preset already shared, and it needs no format change. Letting the sharer save a preset that only holds some parts changes the container and affects readers we do not control. Phase 1 is the picker. Phase 2 is partial saving, built on the same parts model.

No issue is filed yet. One should be, before implementation starts.

## What happens today

Two apply paths, both all or nothing.

Singleplayer is `loadPreset` in `src/play/pages/SkirmishPage.tsx:667`. Six setters in a row: participants, game, map, start-pos type, boxes, mod options, restrictions. It is wired straight to the preset row's Load action at `SkirmishPage.tsx:898`, so there is no intermediate step to hang a choice on.

The battle room is `applySkirmishPresetInPlace` in `src/multiplayer/pages/BattleRoomPage.tsx:235`. It sets the map, batches your own seat through `setBattleStatusBatch`, writes the option tags through `room.applyOptionTags`, draws the preset's boxes, and adds the bots through `addHostSeedBots`. It never touches another seated human, which `ApplySkirmishPresetPopover.tsx:18` states as a deliberate rule rather than an accident.

That second path matters for a reason beyond this feature. `room.applyOptionTags` is one batched script-tag write on a battle coilbox founded, and a paced run of one `!bSet` per option on a SPADS autohost (`src/multiplayer/battle/useBattleRoom.ts:144`). So the option-carrying part of a preset already reaches an autohost as autohost commands. Partial import decides which of those commands get sent.

Importing from the hub is not a third path. It saves the preset into your list (`SkirmishPage.tsx:925`) rather than applying it, so it needs no picker.

## The parts

A new `src/play/presetParts.ts` defines seven parts. They partition `SkirmishDraft` (`src/play/drafts.ts:29`) exactly, with every field belonging to one part and no field belonging to two.

| Part | Covers | Notes |
|---|---|---|
| `game` | `gameName` | Singleplayer only |
| `map` | `mapName` | |
| `startPositions` | `startPosType`, `startRects` | One part, because boxes only apply in mode 2 |
| `modOptions` | `modOptionValues`, tweak keys excluded | |
| `tweakSlots` | the tweak keys within `modOptionValues` | |
| `teams` | `participants` | In a battle room this means your seat and the bots |
| `restrictions` | `restrictions` | |

The partition is the safety property the whole feature rests on. If the parts cover the draft exactly, then applying with every part ticked has to produce the same draft the preset holds, which makes today's behaviour a special case of the new code rather than a branch beside it. Write that as a test before writing the picker.

`game` is absent from the battle room's picker rather than disabled. The room already filters the offered presets to `p.gameName === battle.modname` (`BattleRoomPage.tsx:616`), so there is never a game to change and a permanently ticked row would be noise.

Splitting the tweak slots out of the mod options costs almost nothing. `TWEAK_KEY` in `src/workshop/deliveryRoutes.ts:46` matches `tweakdefs`/`tweakunits` with an optional number, on the key name alone. The existing `tweakSlotOptions` at line 69 takes the game's option schema because its caller wanted each slot's declared default, but the split here needs no schema. Export a bare `isTweakSlotKey(key: string): boolean` from the same file and use it in both places, rather than matching key shapes in a second location. Keeping it schema-free is what makes the split work for a preset whose game is not installed, which is the normal case when browsing the hub.

## Replace or overlay

Replace and overlay only mean anything for the two parts that are maps of keys to values. The other five hold a single value each, so taking them is replacement by definition and offering a choice would be a control that does nothing.

So `modOptions` and `tweakSlots` each carry their own replace-or-overlay control in the picker, defaulting to replace. Overlay was the first choice here, on the grounds that it is less destructive and reads the way "take this part and leave the rest" sounds. It cannot be the default, and the reason is the partition property above. A key the current draft sets and the preset does not survives an overlay and is dropped by a full load, so an overlay default would make every part ticked mean something other than what Load has always meant. Replace is what a wholesale load does, so replace is what taking a whole part does.

Overlay stays as the opt-in for the case it is actually good at: a preset that deliberately sets three options and means to leave everything else alone. That is a fragment of a ruleset rather than a ruleset, and the person applying it knows which they have.

The two modes mean different things on the two surfaces, and the difference is not cosmetic.

In singleplayer, replace deletes the keys in that part before writing the preset's. Deleting is enough because `effectiveOptions` (`src/play/participants.ts:387`) fills every unset option with the game's declared default at launch.

In a battle room, replace writes the game's declared default rather than deleting the tag. A battle's options are shared state that every other client reads, and `missingOptionTags` (`src/multiplayer/battle/battleOptions.ts:127`) exists precisely because an absent tag means the engine substitutes its own built-in value instead of the game's. Deleting would push a wrong value to everybody in the room.

## Dependencies between parts

Warn rather than block, with one exception.

Start boxes are map fractions on the 0..200 grid, so taking `startPositions` without `map` lands boxes drawn for one map on another. That is worth a warning naming the preset's map, and no more. A layout that splits the map north and south is perfectly reasonable to want on a map of your own, and refusing it would be the tool deciding it knows better.

The same applies to a box set naming allies your roster does not have, which happens when `startPositions` is taken without `teams`. Warn, listing which allies have boxes with nobody in them.

The exception worth blocking is in singleplayer only: `modOptions`, `tweakSlots` or `restrictions` ticked while `game` is unticked and the preset's game differs from the current one. Those keys are declared by the game, so carrying them across games produces keys the target game does not know. Disable those rows with the reason shown, rather than letting somebody apply a setup that cannot work.

Warnings belong in the picker, next to the row that causes them, not in a notification after the fact. A warning you can still act on is worth showing. One that arrives after the thing already happened is just an apology.

## Where the picker appears

In the battle room it goes inside `ApplySkirmishPresetPopover`, which already has a pick-then-apply flow with a confirm step. The parts list sits below the preset choice. No new surface, and no extra click for anybody who wants everything.

In singleplayer, Load stays a single click that applies everything, because that is the common case and making people confirm a full load every time would be a tax on the thing that already works. The picker sits behind a secondary action on the preset row, as a popover rather than a dialog.

Rows use `CheckField` from `src/components/Field.tsx:52`. Each row shows the part name and a one-line summary of what this preset actually holds for it: the map name, "12 options", "3 tweak slots", "2v2, 4 bots". A part the preset carries nothing for is shown disabled and labelled, rather than hidden, so the list does not reshuffle as you move between presets.

Two rows can be disabled for reasons beyond the preset's contents. In a battle room, `restrictions` is disabled for anybody who is not the founder, because unit restrictions are `game/restrict/*` script tags with no autohost path at all (`useBattleRoom.ts:152`). Say that in the row rather than hiding it, so a host on an autohost knows why the option is not theirs.

## Applying a selection

The two surfaces need different mechanics, and trying to share one apply function between them would force the state-setting path to pretend it has side effects.

Singleplayer gets a pure function:

```ts
applySelection(current: SkirmishDraft, preset: SkirmishDraft, selection: PresetSelection): SkirmishDraft
```

It returns a complete draft, so `loadPreset` calls it and then runs the same six setters it runs today. The function is pure, which means the partition property, the overlay rule and the replace rule are all testable without rendering anything.

The battle room cannot use that, because its steps are sends rather than assignments and re-sending an unchanged value is not free. Instead `applySkirmishPresetInPlace` takes the selection and guards each step: the map write on `map`, the seat batch and the bot adds on `teams`, the boxes on `startPositions`, and the option tags on whichever of `modOptions` and `tweakSlots` are ticked, plus `startPositions` for the start-pos tag.

`draftToHostSeed` stays as it is. Rather than teaching it about selections, filter the `scriptTags` it produces through a new `filterOptionTags(tags, selection)` helper placed next to `battleOptionTags` in `battleOptions.ts:84`, which is already the file that decides which script tags belong to which scope. The tweak and non-tweak split there uses the same `isTweakSlotKey` as the parts model.

### Two existing behaviours that a selection breaks

Both of these are live code that assumes a full apply. Neither shows up as a compile error.

`loadPreset` pre-seeds `prevArchive.current` to the incoming game's archive (`SkirmishPage.tsx:668`) to stop the reset effect at `SkirmishPage.tsx:317` from wiping the mod options it is about to restore. That effect exists because mod options are declared per game and the ones you had are meaningless under a different one. With a selection, the pre-seed is only correct when `modOptions` is ticked. Ticking `game` while leaving `modOptions` unticked has to let the reset effect fire, because the alternative is carrying the old game's option keys into a game that never declared them. So the pre-seed becomes conditional on the selection, and unticking `modOptions` across a game change clears them rather than keeping them.

`ApplySkirmishPresetPopover` gates its Apply button on `mapInfo.status === "ready"` (`ApplySkirmishPresetPopover.tsx:38`), because it needs the map's checksum to call `room.setMap`. With a selection that gate belongs to the `map` part alone. Leaving it where it is means you cannot apply a preset's mod options until its map resolves, and cannot apply them at all if you do not have that map, which is the case where taking only the options is most useful. Move the gate behind `map` being ticked.

## Phase 2: saving a partial preset

Saving with parts unticked writes a preset that holds only those parts. It reuses the parts model and the picker component, so the work is in the format rather than the UI.

The format is the problem. `parsePresetJson` (`src/play/presets.ts:185`) hard-requires `participants`, `gameName`, `mapName`, `startPosType` and `modOptionValues`, and returns `null` when any is missing. A partial preset fails that check, so every build including the current one rejects it as malformed, and the user sees an import failure with no reason attached.

This is the case where bumping `PRESET_KIND_VERSION` (`presets.ts:18`) to 2 is correct, and it is worth writing down why, because the standing rule is not to bump for additive changes. That rule exists so an old build does not refuse a file over a field it never reads. Here an old build genuinely cannot read the file, and the version check turns a silent parse failure into "this came from a newer coilbox", which is the true statement.

The payload at version 2 gains an explicit `parts: PresetPart[]` naming what the preset claims to hold. Inferring from which fields are absent does not work, because `modOptionValues: {}` is ambiguous between a preset that deliberately sets no options and one that does not carry that part at all. Naming the parts removes the guess.

Two readers outside this code have to cope before phase 2 can ship. The hub's preset card draws teams and a playing count (`src/hub/preview.ts:146`), and a mod-options-only preset has no teams to draw, so it needs a different card rather than an empty one. The hub's autohost export, in progress separately, reads a shared preset's options to generate `!bSet` lines, and needs to handle a preset that carries options and nothing else. Phase 2 should land after that export rather than beside it.

## Testing

`presetParts.test.ts` carries the weight. The partition property first: every part ticked returns a draft equal to the preset, for a preset that exercises all seven parts. Then each part in isolation against a current draft that differs in every field, asserting exactly one field group moved. Then overlay and replace on `modOptions` and `tweakSlots` separately, including the case where the preset carries a key the current draft does not and the case where it carries none.

Beyond that, one dom test per surface. In singleplayer, loading with only `map` and `startPositions` ticked leaves participants and mod options untouched. In the battle room, unticking `teams` means `setBattleStatusBatch` and `addHostSeedBots` are not called at all, which is the assertion that catches a guard placed on the wrong side of a step.

Every existing test must pass unchanged. The default selection is everything, so any test that breaks is a real behaviour change rather than a test that needs updating.

## Out of scope

Per-option cherry-picking inside `modOptions` stays out. The picker works on whole parts, and the hub's autohost export already covers the case of wanting the option lines and nothing else.

Remembering a selection between applies stays out too. There is no evidence anybody wants the same subset twice, and a remembered selection that silently drops a part on a later apply is a worse failure than ticking four boxes again.
