# Unit builder keyframe timeline

2026-11-22. Design for issue #5377: a keyframe timeline in the unit builder that writes its motion into the unit's Lua script. A player asked for it in #5364, with Blender's editor switcher as the model for fitting an animation workspace in.

Engine facts are read from the RecoilEngine checkout in `~/dev/RecoilEngine` and cited by file and line.

## What is there today

The builder already has most of the parts. What it lacks is keys on their own channels and a view of them over time.

- Poses (#3355). A pose is a sparse set of `Turn` and `Move` destinations per piece, in radians and elmos (`LegoPose` in `src/lego/model.ts`, `src/lego/pose.ts`). The player holds one in pose mode and moves pieces with the gizmo (`usePoseMode.ts`). Pose mode has its own undo stack that runs before the document's.
- Actions (#3356, #3358). An action is a list of keys, each a saved pose and the seconds to reach it from the key before, with a trigger call-in, a loop switch and blend times (`LegoAction`). `emitActions` in `src/lego/actions.ts` writes each action as a thread of `Turn`, `Move` and `Sleep`. Every key moves every piece in step, because a key is a whole pose.
- The action editor is `ActionsDrawer.tsx`, a 360 pixel drawer on the left titled "Action timeline". It lists keys as rows of a pose picker and a seconds field. There is no time axis, no scrubbing within the action and no way to key one piece at a different moment from another.
- Presets (`animPresets.ts`) are generated motion. #3360 settled that every preset stays and writes the same script, and #4512 added "convert a preset into an action" (`presetToAction.ts`).
- A script can be read back into actions (`readActions` in `src/lego/importScript.ts`), all or nothing. It accepts only threads where every axis that moves arrives when the next `Sleep` ends, which is the shape `emitActions` writes.
- Once the player takes the script over, `project.script` holds their text, export writes it as is, and neither presets nor actions write anything. A compiled `.cob` unit plays its bytecode.
- The preview runs the generated script through the Rust runtimes and the viewport plays the returned `ScriptTimeline` (`scriptPlayback.ts`). The scrubber in `AnimationPanel.tsx` seeks it, and `ScrubberMarks.tsx` puts seek buttons under it.

## What the engine can express

- `Turn(piece, axis, dest, speed)` and `Move` head for the destination at a constant `speed / 30` a frame from the frame of the call (`CUnitScript::TurnToward` and `MoveToward`, `rts/Sim/Units/Scripts/UnitScript.cpp:117-150`, ticked at `UnitScript.cpp:315`). Without a speed the piece jumps there.
- A turn takes the shorter way round. The destination is clamped to one turn (`UnitScript.cpp:507`) and the step is `fmod(dest - cur + 3π, 2π) - π` (`UnitScript.cpp:142`). So a turn of more than half a circle between two keys goes the other way, and exactly half a circle goes the negative way.
- `Spin` is the only call with acceleration (`UnitScript.cpp:177-191`, `456-481`), and it spins forever. There is no easing on `Turn` or `Move`.
- `Sleep(ms)` wakes the thread `floor(ms / 33)` frames later in the framework games ship, which is what `actions.ts` and `importScript.ts` already assume.

So one channel between two keys is exactly a linear segment, rounded to whole frames. Easing curves cannot be written as one call. They could only be approximated by many short linear calls.

## Decisions

### 1. A key is one value on one channel at one frame

A channel is one piece, `turn` or `move`, and one axis. A track is a channel's keys in frame order. An action gains optional tracks:

```ts
export interface LegoActionTrack {
  /** Piece id, as poses use, so a rename keeps the track. */
  piece: string;
  kind: "turn" | "move";
  axis: 0 | 1 | 2;
  /** Frame ascending, one key per frame. Frames are whole sim frames from
   *  the action's start, because `Sleep` and the engine both count frames. */
  keys: { frame: number; value: number }[];
}

// On LegoAction:
tracks?: LegoActionTrack[];
```

A value is radians for a turn and elmos for a move, the numbers `Turn` and `Move` take, as poses already store. There is no easing field, because the engine has no easing to write. Interpolation is linear and takes the shorter way round for a turn, exactly as the engine moves.

An action holds either pose keys or tracks. An action with tracks has `keys: []`. Pose keys stay valid and nothing converts them on load, so every saved unit opens and exports as before. The first edit the timeline makes to a pose key action converts it to tracks in the same document edit, so one undo puts the pose keys back. After that the action no longer follows its poses. Editing a pose changes only actions that still use pose keys.

This is an additive field, so the unit file's version does not change. A build older than this one reads an action with tracks as an action with no keys, and that action writes nothing there.

A track whose piece has been deleted stays in the document and is skipped when written, as a pose naming a deleted piece is now. The problems list counts them.

### 2. One plan, written as Lua and played in the preview

Keyframes do not get a second script writer. `emitActions` changes from walking poses to walking tracks:

1. `actionTracks(action, project)` lowers pose keys to tracks. Each channel any key's pose moves gets a key at every pose key's frame, rest (0) where that pose leaves it alone. Frames are the running sum of each key's seconds rounded to whole frames, which is how `framesOf` counts them today.
2. `planAction` turns tracks into a list of calls, each with a frame, a channel, a destination and a speed. This is the one place timing is decided.
3. `emitActions` prints the plan as Lua. `bakeAction`, new, plays the plan frame by frame into a `ScriptTimeline` for the timeline's preview (section 4).

The plan follows today's rules, widened from "every channel keys together" to "each channel keys on its own":

- Breakpoints are every frame on which any channel has a key. A channel with a segment starting at a breakpoint gets one call there, its next key's value at the speed that arrives on that key's frame. A channel whose value does not change writes nothing. Calls at one breakpoint are written in piece order, then turn before move, then x, y, z, as `stepLines` does now. One `Sleep` waits for the next breakpoint that has calls.
- A channel's first key is reached from rest, starting at frame 0. A key on frame 0 is a jump, a call with no speed.
- The action's length P is its last key frame over all tracks. A looping action wraps each channel from its last key to its first, starting at its last key and arriving P frames after its first. The lead covers frames 0 to P and the `while true do` body covers one lap after it, as today.
- A non-looping action ends after its last calls with no `Sleep`, as today.
- With a blend in, every channel blends over the blend time to its value at the action's first key frame, then the lead continues from there. Where every channel's first key is on the same frame, which is every action made of poses, this is exactly today's script.
- Signals, stop functions, the blend helpers and the start lines in the trigger's call-in do not change.

For an action made of poses this produces the same Lua, byte for byte. That is the first test (Testing, 1).

A turn segment of half a circle or more is written as the engine will play it, the shorter way, and the preview shows it going that way. The problems list names the channel and the two frames, and says to add a key between them. Splitting it silently would add keys the player did not make and would not read back.

A small example. Arm turns on x to -0.5 at frame 10 and back to 0 at frame 20. Hand turns on z to 0.3 at frame 15 and back to 0 at frame 30. It does not loop:

```lua
local function action_Wave()
  SetSignalMask(SIG_ACTION_WAVE)
  Turn(arm, x_axis, -0.5, 1.5)
  Turn(hand, z_axis, 0.3, 0.6)
  Sleep(330)
  Turn(arm, x_axis, 0, 1.5)
  Sleep(165)
  Turn(hand, z_axis, 0, 0.6)
end
```

Today's reader refuses this, because the hand's first call arrives on frame 15, after the `Sleep` that follows it has ended.

### 3. Keyframes live on actions, beside the presets

- Presets are unchanged and keep writing their own threads (#3360). The timeline never edits a preset. To key a preset's motion, the player converts it to an action with the existing button (#4512), and the result opens in the timeline.
- Actions and presets on one piece clash as they do now, and `actionClashes` reports them. The timeline marks a piece row that something else also moves, with the clash text in its tooltip.
- Once the script is the player's own, or the unit plays a compiled script, the timeline refuses. The tab says the unit runs its own script and offers a button that opens the Script tab. Writing keys into text the player owns would be a second writer over their file, and would break the rule that an export writes exactly what they wrote. "Discard this script and use the presets" stays the way back. Importing a script that `readActions` can read already turns it into actions, and section 5 widens what it can read.
- Actions are shared by every loadout, as now.

### 4. The timeline is a third tab in the strip under the viewport

The strip along the bottom gains a Timeline tab beside Inventory and Script. There is no separate animation workspace. The reasons are in the code:

- The strip is already where an editor that needs the viewport beside it goes. The Script tab lives there (`BuilderPage.tsx:3134-3195`). The strip is already resizable (`StripResizer`, height kept by `usePanelHeight("strip")`), collapsible and able to fill the window. A timeline needs every one of those.
- A time axis needs width. The strip spans the viewport's width. `ActionsDrawer` is 360 pixels wide and covers the left of the viewport, which is why it lists keys as rows.
- The side panel's Pieces, Animation and Game tabs already switch editors the way Blender's editor switcher does. Animation on the side and Timeline in the strip is an animation workspace made from parts the page has. A page level mode would mean two layouts of one 4,292 line page sharing one viewport, for no gain the player can see.
- An imported unit hides Inventory and keeps Script, because it has no pack parts. It keeps Timeline for the same reason it keeps Script: its adopted script is where its actions came from.

What the tab holds:

- A header row. The action picker, a new action button, play and pause, step back and forward one frame, the frame readout, the loop switch, a Key button, the selected key's value, a settings button and a help icon. Settings opens a registry popover with the name, "Starts on" and blend in and out, the fields `ActionsDrawer` has now. The help icon's popover holds the explanation. Nothing else on the tab is help text.
- A ruler. The registry `Slider` the Animation panel's scrubber uses, in seconds with a tick per frame. That scrubber row is pulled out of `AnimationPanel.tsx` into a shared component so both use one. It runs to one second past the last key, so a key can be dragged later. The tab's width is the zoom.
- Rows. One row per piece the action moves, in piece order, with a diamond on each frame any of its channels keys. A row expands to one row per channel that has a track, named like "Turn x". A key is a button placed with `markPercent` from `scriptMarks.ts` and the same half thumb inset `ScrubberMarks` uses, so a key and the playhead line up.

The Animation panel's actions list opens an action in this tab where it opens the drawer today. `ActionsDrawer.tsx` is deleted once the tab has every field it had.

The tab looks like the Animation panel's existing scrubber and the Script tab, using picoframe's `Button` and `Input` and the registry's `Slider`, `Switch`, `Popover`, `Tooltip` and `Select` (through `OptionSelect`). It adds no new look.

### 5. Editing

Every change is one document edit through the `onEdit` the drawer uses now, so the builder's undo and redo cover it.

- Playback. The tab bakes the action through the plan (`bakeAction`) into a `ScriptTimeline` and hands it to the viewport through the same `onScriptTimeline`, `onScriptFrameChange` and `onScriptPausedChange` the Animation panel uses. A looping action bakes the lead and one lap and loops the lap. A one shot action plays once and holds. It plays the action alone, from rest, at once, with no wait for the runtime. Starting a run in the Animation panel replaces it, and the other way round.
- Scrubbing. Dragging the ruler pauses and seeks, as the Animation panel's scrubber does.
- Keying from the current pose. While paused, the unit is in pose mode, held at the baked pose on the playhead's frame. The gizmo changes the held pose. Key writes a key at the playhead for every channel whose held value differs from the action's value on that frame. It replaces a key already on that frame. A channel with no track gets one. Key is disabled when nothing differs. Moving the playhead or pressing Play drops a held change that was not keyed, as Blender does. Pose mode's own undo stack still runs first.
- The value field. Selecting a key shows its value in the header, in degrees for a turn and elmos for a move. Typing a value is one edit.
- Moving keys. A key drags along its row, snapping to whole frames. A diamond on a piece row moves every key of that piece on that frame. A drag is one edit, committed when the pointer is released. A key cannot land on a frame its channel already keys. It goes back where it was. With a key focused, Left and Right move it one frame, and Delete or Backspace removes it.
- Looping. The loop switch is the action's `loop`. The ruler marks the end of the lap at P. While the action loops, the stretch after P shows each channel wrapping back to its first key.
- New action. It creates an action with no keys and selects it. The player poses and keys it from there. A pose key action converts to tracks on its first timeline edit (section 1).

Keyboard: every key is a button with a name such as "Turn x of arm, frame 12, 15 degrees". No new keyboard shortcuts in this version. The builder's shortcuts can now be rebound, so keying and playback shortcuts belong in that list when they come, rather than being fixed keys on the tab.

### 6. Export and round trip

Export writes the same `scripts/<unit>.lua` as now, with the same header comment. Each action is still one `-- Action: <name>` thread, a signal, a stop function when it loops, and start lines in its trigger's call-in. The timeline adds no new library code and no data block to the file. The calls in the script are the whole record, and the reader rebuilds the keys from them.

The generated unit script stays the player's file. `lua/LICENSE.md` covers the Lua coilbox ships and the Lua it generates into a game at run time. It does not put a licence on an exported unit script, and the builder writes no licence line into one. This design keeps it that way. Keyed motion is plain `Turn`, `Move` and `Sleep` calls in the player's script, with no coilbox library included.

`readActions` widens to read the plan's shape back. A call at frame s with destination d and speed v implies a key at s with the channel's value there, and a key at d on the frame it arrives, `s + |d - value| / v × 30`, rounded to the nearest frame. A script whose arrival lands more than half a frame from a whole frame does not fit, and the all or nothing rule keeps it as the player's own script. A script that fits the old pose shape still reads back as pose keys and poses, as now. Anything wider reads back as tracks.

Two kinds of key do not survive a round trip, and neither changes the motion. A key that repeats the channel's previous value at the end of a non-looping action writes nothing, so it does not come back. A key whose value equals the previous one and starts no change also writes nothing. `normaliseTracks` drops those keys, so the round trip test compares normalised tracks.

## Testing

1. Writer regression. Every action in the existing tests and in `actionFixtures.ts`, lowered to tracks, writes byte for byte the Lua it writes now. This includes the blend tests in `actionBlend.test.ts`.
2. Round trip. For fixtures with staggered channels, a loop whose channels start and end on different frames, a key on frame 0, a one key action and a blended action: `readActions(emitActions(tracks))` equals `normaliseTracks(tracks)`, and `emitActions(normaliseTracks(tracks))` equals `emitActions(tracks)`.
3. Plan against the framework. The printed Lua runs under the luajit framework stand-in in `actionFixtures.ts`, and its piece values on every frame match `bakeAction` to four places. This is what makes the timeline's preview what the game runs.
4. Engine rules. The plan and the bake take the shorter way on a turn of more than half a circle, and the negative way on exactly half. The problem for it names the channel and frames.
5. File format. `parseActions` keeps valid tracks, drops a bad key or a bad track without dropping the action, and a pose key action saved before this change parses and writes unchanged.
6. Editing functions. Each new edit in `actions.ts` (key from held pose, set value, move keys, delete key, convert to tracks) has unit tests, including a move onto an occupied frame and the first edit of a pose key action being one undo step.
7. The tab. `dom.test.tsx` coverage for opening from the Animation panel, the refusal on an owned or compiled script, keying, dragging a key, arrow keys and Delete on a focused key.
8. On screen, through the Tauri MCP on a seeded portable instance: make a two piece action with staggered keys, play it on the timeline, then play the unit in the Animation panel's matching scenario and check that the motion is the same. Then use the builder's "Check it loads" once on the exported unit.

## Delivery

Five PRs in this order, in the milestone "Unit builder: keyframe animation" (https://github.com/tomjn/coilbox/milestone/106). Each updates `docs/developers/lego-builder.md` for its own part.

1. #5394 Tracks on actions, one plan, the writer and the bake. Sections 1 and 2. M.
2. #5395 Read staggered scripts back into actions. Section 6. M.
3. #5396 The Timeline tab: view, scrub and play. Section 4, and playback, scrubbing and looping from section 5. L.
4. #5397 Keying from the pose and editing values. Section 5. M.
5. #5398 Moving and deleting keys, by pointer and keyboard. Section 5. M.

1 comes first. 2 and 3 need only 1. 4 needs 3, and 5 needs 4.

## Out of scope

- Easing curves and a graph editor. The engine has no easing, so a curve could only be written as many short linear calls. Those would read back as many keys, not as one curve, so the round trip would lose the curve. Blend in and blend out already ease an action in and out.
- `Spin`, `StopSpin` and `WaitForTurn` and `WaitForMove`. Continuous rotation is the wheel preset's job, and the plan times everything with `Sleep`.
- Keys for showing and hiding pieces, effects, explosions and sounds.
- Copy and paste of keys, box select, zoom and pan on the ruler, and onion skins.
- More than one action on the timeline at once.
- Editing the motion of a script the player owns, or a compiled script.
- Keyboard shortcuts for keying and playback.
