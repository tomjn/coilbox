# A stand-in unit for the model editor

Give the unit builder a second thing in the scene: a crude, inert unit the edited model can aim at, build, and carry. Today an animation plays against nothing, so a script that aims at a target it cannot see looks the same whether it is right or wrong.

This is project 1 of 3. Projects 2 and 3 are named at the end and are not designed here.

## What is there today

Measured by reading the code, not inferred.

`src/lego/pages/components/ModelViewport.tsx` is raw three.js over `src/lib/useCanvas3D.ts`. The scene is one unit plus fixed view aids: ground and grid from `src/lego/buildPlate.ts`, a front marker, an axes helper, a backdrop from `src/lego/environment.ts`, and a parked scale figure from `src/lego/referenceObject.ts`. Nothing else occupies the scene and nothing but a piece ever moves.

Playback output is `ScriptTimeline` in `src/lego/scriptPlayback.ts:15-53`: `frames[][]` of six numbers per piece, `hidden[][]`, plus errors, warnings and coverage. Piece poses and nothing else.

Aim runs but has nothing to aim at. `SCENARIOS` hands `StartBuilding` the literals `[0.7, -0.2]` and `[-0.6, 0.15]` (`src/lego/scriptPlayback.ts:192-196`) and `AimWeapon1` the literals `[0.8, 0.15]` (`:246`). No target position type exists anywhere in `src/lego`.

Angle units are already correct and need no change. `crates/tauri-plugin-coilbox-anim/src/cobrun.rs:199-200,414-418` records that scenarios are written in radians and scales by `RAD2TAANG`, which matches the engine's own `RadAngleToCobShort` at `rts/Sim/Units/Scripts/CobInstance.cpp:45-56`. The Lua runtime takes radians unchanged, as the engine does at `rts/Sim/Units/Scripts/LuaUnitScript.cpp:582-596`.

## What the engine actually does

From the RecoilEngine checkout in `~/dev`. These four facts set the design.

`AimWeapon` takes heading and pitch in radians relative to the unit's own facing, computed at `rts/Sim/Weapons/Weapon.cpp:410-424` by projecting the wanted direction onto the unit's `rightdir`, `updir` and `frontdir`. The call site negates the heading before passing it, so a positive heading argument means the target is to the unit's left. Positive pitch means above. The aim direction is measured from the piece `AimFromWeapon` returns (`Weapon.cpp:241-244,286-304`).

`StartBuilding` takes `ClampRadPi(h - heading * TAANG2RAD)` and `p - pitch`, computed at `rts/Sim/Units/UnitTypes/Builder.cpp:942-955` from the direction between the builder's `midPos` and the build position. Not from a piece. `midPos` is the value `src/lego/aimPoint.ts` and `AimPointPanel.tsx` already edit, so the editor holds it.

A factory spawns the unit it builds at the world position of the piece `QueryBuildInfo` returns (`rts/Sim/Units/UnitTypes/Factory.cpp:95-101,178`). The zero-argument `StartBuilding()` a factory uses is a separate C++ overload but reaches the same script function (`Factory.cpp:197`, `CobInstance.cpp:541`).

Transport attachment splits by transport type. Air and hover transports have the attach piece chosen by the engine: `owner->AttachUnit(unit, owner->script->QueryTransport(unit))` at `rts/Sim/Units/CommandAI/MobileCAI.cpp:1448-1455`. Ground and ship transports call `TransportPickup` and leave the script to attach itself with a piece of its own choosing (`MobileCAI.cpp:1456-1464`), reaching `CUnitScript::AttachUnit` through the COB `ATTACH` opcode or the Lua callout.

## Goals

Show what the model is animating towards, as an object rather than a number.

Make the aim call-ins honest, so heading and pitch come from a visible target using the engine's own formula and sign convention.

Give transport load and unload a preview, which they have none of today.

## Not in scope

No control of the stand-in. It is not draggable and takes no coordinates. Its pose comes from the scenario.

No collision volume, because nothing in the editor collides with it. It carries one radius, used for placement and sizing.

No pieces and no animation of its own. It is rigid.

No game model as a stand-in, ever. That is what pulls in animation, collision and a parent game, and it is why the reference object stays a scale reference and is left untouched.

No landing pad scenario. `QueryLandingPad` has no caller anywhere in `rts/` outside the script interface files, and there is no airbase handler, `reservedPad` or `repairPad` anywhere in `rts/Sim/`. `Falling` and `Landed` are about parachuting a dropped unit (`Unit.cpp:604-619`, `GroundMoveType.cpp:1671-1677`), not pads. Recoil leaves repair pads to game Lua, so there is no engine sequence to preview.

No ground or ship transport. Their attach piece comes from a script call both runtimes currently discard, so it waits for project 2.

No particles of any kind.

## 1. The stand-in

A new module `src/lego/standIn.ts`, a sibling of `referenceObject.ts` rather than a mode of it. It builds and disposes one three.js group, and exposes a function that places that group for a given frame. It knows nothing about scripts.

Called "Stand-in unit" in the UI. Dummy unit is the phrase a Spring modder would reach for and is an easy rename if preferred.

## 2. Shape and material

A squat eight-sided prism, flat shaded, with the front face pulled forward into a wedge and the top gently domed. Facing reads from the wedge, up reads from the flat base against the dome. It stays convex and has no moving parts.

Material is `MeshStandardMaterial` with `flatShading`, a single small tiling grey panel texture, and a distinctly coloured nose facet. Not a stone or metal photograph, because flat shading is what makes the facets readable and a busy texture fights it.

Silhouette legibility is judged by looking, not specified. Build two or three candidates, screenshot each from a low rear angle, which is the case where an upside-down sphere fails, and keep whichever reads best.

## 3. Where it sits

`Scenario` gains an optional track. Positions are unit-local and expressed in multiples of the stand-in's own radius, so one track serves a scout and a factory alike and needs no knowledge of where the camera is.

```ts
export interface StandInKey {
  frame: number;
  /** Unit-local, in multiples of the stand-in's radius. */
  pos: [number, number, number];
  /** Radians about the vertical axis, relative to the unit's facing. */
  heading?: number;
}

export interface StandInTrack {
  keys: StandInKey[];
  /** Parent the stand-in to the piece this call-in names, from this frame on. */
  attach?: { from: "QueryTransport"; frame: number } | null;
}
```

Keys interpolate linearly in TypeScript during playback. The stand-in stays a preview aid layered over the timeline, so `ScriptTimeline` does not change and no Rust change is needed.

Its radius is not on the track. It is derived from the edited unit's own bounding size when the track resolves, so a stand-in beside a small scout and a stand-in beside a factory both look like a unit rather than a speck or a wall. Key positions are multiples of that radius rather than absolute elmos, so one track serves units of any size.

## 4. Attachment

When `attach` is set, the stand-in's transform for frames at or after `attach.frame` is the attach piece's transform from the baked pose, times an offset that rests the stand-in on top of that piece.

The piece comes from the existing static probe, `legoProbeScript` and `ScriptProbe` in `src/lego/scriptPlayback.ts:56-72`, already used by `src/lego/inferRoles.ts`. Scripts return a fixed piece for this in practice. Reading a real per-call return value means a new channel out of both runtimes and belongs in project 2.

When the probe names no piece, the stand-in holds its last keyed position and the panel says the script named no transport piece. Saying so is the point, because that is exactly the bug the preview exists to expose.

## 5. Making aim honest

`ScriptEvent` gains a marker that replaces literal args with computed ones.

```ts
aimAtStandIn?: { from: "AimFromWeapon" | "midPos" };
```

A pure resolver in `src/lego/aimResolver.ts` takes a scenario and the model, and returns events with concrete radian args. It is also what turns radius multiples into elmos, so the track and the aim agree on where the stand-in is. `midPos` uses `project.mid` and reproduces `Builder.cpp:942-955` exactly. `AimFromWeapon` uses the rest position of the piece the probe names.

The rest position is a documented approximation. The engine measures from the piece's live animated position, but the args must be known before the script runs, so using the animated position is circular. A turret's pivot moves little relative to the unit, so the error is small. Record it in the code as a comment, not as a two-pass run, because a second run doubles the latency of every scrub.

Sign convention comes from the engine and is asserted in a test rather than trusted: positive heading means the target is to the unit's left, positive pitch means above.

## 6. Scenarios

`building` and `firing` keep their events and gain a track, with their literal args replaced by `aimAtStandIn`.

`building-factory` gains a track that places the stand-in at the rest position of the piece the probe names for `QueryBuildInfo`, matching `Factory.cpp:95-101`.

Two new scenarios, both air transport only:

`transport-load` drives `BeginTransport`, `QueryTransport` and `TransportPickup`, with the stand-in approaching and then attaching.

`transport-unload` drives `StartUnload`, `TransportDrop` and `EndTransport`, with the stand-in detaching and settling below.

Arguments follow the Lua convention, which differs from COB. `BeginTransport` and `QueryTransport` take a unit id in Lua where COB takes `height * 65536`, and `TransportDrop` takes separate x, y and z where COB packs x and z (`LuaUnitScript.cpp:139-141,787-826`). The scenario writes the Lua form and the COB runtime converts, matching how radians are already handled.

## 7. UI

The stand-in appears whenever the running scenario defines a track. One toggle to hide it, placed with the existing environment and reference controls in `BuilderPage.tsx`, persisted through `src/lego/panels.ts` the way the other view settings are. No radius control and no position control, because both come from the scenario and the edited unit's own size.

## 8. Testing

`src/lego/standIn.test.ts` covers key interpolation, including a frame before the first key and after the last.

`src/lego/aimResolver.test.ts` covers the resolver. A stand-in placed to the unit's left gives a positive heading and one to the right gives a negative one, each checked against the engine formula rather than against a recorded output. A stand-in above the unit gives a positive pitch. A `midPos` offset from the origin changes the result, since that is the whole reason the engine uses `midPos`.

`src/lego/scriptPlayback.test.ts` gains cases for the two new scenarios and for a scenario whose probe names no transport piece.

`ModelViewport.dom.test.tsx` covers the stand-in appearing for a scenario with a track and not for one without.

## Sizing

M. S if the wedge shape lands first time and no scenario needs reworking once it is visible on screen.

## Follow-on projects

Project 2, script events out of both runtimes. `crates/tauri-plugin-coilbox-anim/src/cobrun.rs:886-915` and `crates/coilbox-springlua/src/unitscript.rs:1972` already stub `EmitSfx`, `AttachUnit`, `DropUnit`, `Explode` and `PlaySoundFile` with notes reading "Effects are not drawn in the preview" and "Attaching a unit does nothing in the preview". Project 2 records them as frame-stamped events on `ScriptTimeline` instead of discarding them, which also brings ground transport within reach. The CEG offset is `SFX_CEG = 1024` and `sfxType - 1024` indexes the unit's own generator list (`rts/Sim/Units/Scripts/CobDefines.h:9-20`, `UnitScript.cpp:736-750`). Note that Lua reverses the argument order against COB, taking piece then type (`LuaUnitScript.cpp:1415-1435`).

Project 3, a particle renderer in three.js. Muzzle flash, tracer, nano beam, smoke, and a neutral puff for a CEG. Nano runs from the piece `QueryNanoPiece` names to the build target, matching `rts/Sim/Units/UnitTypes/Builder.cpp:979-992`. Particles must be a pure function of emission frame and current frame, because playback is scrubbable and an accumulating simulation gives a different picture each time you scrub to the same frame.
