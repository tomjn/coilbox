# Effects in the model editor's preview

Project 3 of the stand-in work. The preview draws what a unit script emits: nano spray from the piece `QueryNanoPiece` names to the stand-in, the muzzle flame and a tracer when a weapon fires, and the engine's built-in sfx. A CEG is drawn as a neutral puff. Everything drawn is a pure function of the frame, so scrubbing to a frame always shows the same picture.

Read first: `2026-09-22-model-editor-stand-in-unit-design.md` ("Follow-on projects") and `2026-09-23-script-events-design.md` (project 2, whose events this project draws).

## What is there today

Project 2 is merged, parts A (#3004), C (#3006) and B (#3007). Both runtimes record `sfx`, `explode`, `sound`, `attach` and `drop` as `ScriptOutput` events on `ScriptTimeline.events` (`src/lego/scriptPlayback.ts:77-114`, `crates/coilbox-unitpose/src/lib.rs:190-236`). The scrubber marks them (`AnimationPanel.tsx:656`). The panel says `EFFECTS_NOTE`, "Effects are marked on the scrubber, not drawn." (`lib.rs:25`, pushed at `:608`).

The viewport is posed per frame from two places: the play loop in `useScriptFrameStepping.ts:76-156` and the paused-frame effect at `:161-176`. Both call `applyTimelineFrame`, then `placeStandIn` (`standInPlayback.ts`), then render. `releasePoint` in `standInPlayback.ts` poses the scene at an earlier frame, reads a piece's group, re-poses, and caches the answer per timeline in a `WeakMap`. That is the pattern this project reuses.

A frame is 1/30 s (`FPS`, `lib.rs:29`) and a preview is 450 frames (`PREVIEW_FRAMES`, `scriptPlayback.ts:144-147`).

Two things are wrong today and this project fixes them:

- The compiled runtime treats `show` as unhiding the piece everywhere (`cobrun.rs:907-913`). Inside a fire function the engine does not unhide anything. It draws a muzzle flame instead (below). So a TA-style `show flare` in `FirePrimary` leaves the flare piece visible in the preview, which never happens in a game.
- The Lua runtime has no `Spring.UnitScript.ShowFlare`.

## What the engine does

From `~/dev/RecoilEngine`. These facts set the design.

**An sfx number picks a kind** (`CobDefines.h:9-20`, `UnitScript.cpp:651-800`). The order of the checks matters, because the high ranges are bit tests:

| Number | Kind | Engine draws |
|---|---|---|
| 0 | VTOL | `CHeatCloudProjectile`, speed from the emit direction (`:701-718`) |
| 2 to 5 | wake, reverse wake | `CWakeProjectile`, only when `IsInWater()` (`:634`, `:653-676`) |
| 257, 258 | white, black smoke | `CSmokeProjectile`, 60 frames, colour 0.5 or 0.6 (`:694-699`) |
| 259 | bubble | `CBubbleProjectile`, pinned just under sea level (`BubbleProjectile.cpp:68-71`) |
| 16384 + n | global CEG | generator n by load-time id (`:721-735`) |
| 1024 + n | unit CEG | the unit's generator n (`:736-750`) |
| 2048 + n | fire weapon n | fires from the piece at a point one elmo along the emit direction (`:752-786`) |
| 4096 + n | detonate weapon n | the weapon's explosion at the piece (`:788-`) |

A global CEG's id is assigned at load time and has no name even with the game's archive, so it can only ever be a neutral puff.

**The emit point is the piece's first vertex.** `EmitSfx` takes `GetEmitDirPos` (`UnitScript.cpp:597-617`), which carries the piece's emit position and direction through its animated transform (`LocalModelPiece.cpp:313-323`). Position is vertex 0 and direction is vertex 1 minus vertex 0. With one vertex the position is the origin and the direction is that vertex. With none it is the origin and +Z (`3DModelPiece.cpp:60-78`, the same rule for `.3do` at `3DOParser.cpp:391-396`).

**Nano and the muzzle flame use the piece origin, not the emit vertex.** `CreateNanoParticle` takes `GetRawPiecePos` (`Builder.cpp:979-992`, `Factory.cpp:531-544`) and `ShowFlare` takes `GetPiecePos` (`UnitScript.cpp:968-981`).

**Nano spray is one particle per build frame.** A builder adds build power every frame it builds (`Builder.cpp:339-354`) and the `inBuildStance` guard there is disabled (`|| true`), so it sprays from the moment it starts building. Each particle asks `NanoPieceCache::GetNanoPiece` (`NanoPieceCache.cpp:17-50`). That calls `QueryNanoPiece` until it has seen 30 answers in a row that were already cached, then stops calling and picks at random among the cached pieces. A script that alternates between two nozzles therefore sprays from both.

The particle itself (`ProjectileHandler.cpp:670-746`, `NanoProjectile.cpp:44-63`):

- A builder's moves at 3 elmos per frame towards the buildee's `midPos`. Its direction gets a random offset scaled by `radius / len`, where `radius` is half the buildee's radius. It lives `len / 3` frames.
- A factory's moves at 1 elmo per frame with a random offset of 0.15 and lives `len` frames.
- Colour is the unit's `nanoColor`, default (0.2, 0.7, 0.2) (`UnitDef.cpp:513`). Draw radius is 3. Rotation defaults to 0 and only game Lua changes it (`NanoProjectile.h:33-36`).

**The muzzle flame is `show` inside a fire function.** COB's `SHOW` checks whether the current function, not the thread's first one, is `FirePrimary`, `FireSecondary`, `FireTertiary` or `FireWeaponN`. If it is, it calls `ShowFlare` and leaves visibility alone (`CobThread.cpp:715-728`, names from `CobScriptNames.cpp:59-90`). `ShowFlare` spawns a `CMuzzleFlame` at the piece, facing the direction the weapon wanted to fire (`Weapon.cpp:509-510`). Its size is `min(damageAreaOfEffect * 0.2, min(1500, damage) * 0.003)` (`Weapon.cpp:1229`) and it lives `4 + size * 30` frames (`MuzzleFlame.cpp:45-53`).

**Firing is `FireWeapon`, then `Shot`, then `QueryWeapon`, on one frame.** `CWeapon::Update` runs `UpdateFire` then `UpdateSalvo` (`Weapon.cpp:345-347`). `UpdateFire` calls `FireWeapon` (`:511`) and sets the first salvo for `frameNum + salvoWindup`, where `windup` defaults to 0 (`WeaponDef.cpp:347`). `UpdateSalvo` then calls `Shot`, asks `QueryWeapon` for the muzzle and fires (`:590-595`). The projectile's look depends on the weapon type, which the editor does not know.

**Particles are drawn with blend `ONE, ONE_MINUS_SRC_ALPHA`, depth test on and depth write off** (`ProjectileDrawer.cpp:802-807`).

**Particle bitmaps belong to the game, not the engine.** `ProjectileDrawer` reads `gamedata/resources.lua` from the game with the base content under it (`ProjectileDrawer.cpp:98-106`) and prefixes `bitmaps/` (`:130`, `:480`). The base content's `resources.lua` names `circularthingy.tga`, `explo.tga`, `flame.tga`, `wake.tga` and `smoke/smoke00.tga` to `smoke11.tga` (`cont/base/springcontent/gamedata/resources.lua:59-112`), but none of the three base archives in the installed engine holds any of those files. Games ship them: Balanced Annihilation 15.9.8 has `explo.tga` and `flame.tga` but no `circularthingy.tga`, Metal Factions 2.58 has both, and SplinterFaction 0.1.86 has the smoke set. A missing name gives the engine's default atlas texture (`TextureAtlas.cpp:354-374`).

## Decisions

These were settled with the user on 23 September 2026:

- Nano spray lands first.
- Particles use the game's own bitmaps, not procedural sprites.
- A shot draws a neutral tracer, because the weapon type is unknown.
- **Nano spray looks like original Total Annihilation, not like Recoil.** This is a strong preference. TA draws opaque dots with no alpha and slight per-particle colour variation. Recoil draws one flat colour through the soft `circularthingy` bitmap. The preview keeps Recoil's motion for nano and draws it the TA way.
- Wakes are drawn, as spray at the waterline.

## 1. New outputs from both runtimes

`ScriptOutput` gains three kinds:

```ts
  | { frame: number, kind: "flare", piece: string }
  | { frame: number, kind: "shot", weapon: number, piece: string | null }
  | { frame: number, kind: "nano", piece: string | null }
```

A `null` piece means the query named no piece, and the run notes it once.

**`flare`.** In the compiled runtime, `SHOW` inside a fire function records a flare and does not change visibility. Deciding what counts as a fire function uses the function the opcode is in, as the engine does, and the same name set as `CobScriptNames.cpp`. In the Lua runtime, `Spring.UnitScript.ShowFlare(piece)` records one, with a 1-based piece.

**`shot`.** `ScriptEvent.engine` gains `"fire"`, with a `weapon` number. On its frame the runtime calls `FireWeapon<n>`, then `Shot<n>`, then asks `QueryWeapon<n>` inline and records the answer. This follows project 2's `engine: "attach"`, which asks `QueryTransport` inline.

**`nano`.** `ScriptEvent.engine` gains `"build"`, with `until` (a frame) and `as: "builder" | "factory"`. After each frame from `frame` up to but not including `until`, the runtime runs the `NanoPieceCache` rule and records the piece:

- ask `QueryNanoPiece` while fewer than 30 cached answers in a row have come back
- after that, pick among the cached pieces with the preview's seeded hash (section 3)

The engine's `lastNanoPieceCnt` bookkeeping is ported as it is, including a new piece resetting the count.

The scenarios change:

- `building` gains `{ engine: "build", as: "builder" }` spans matching its two `StartBuilding` to `StopBuilding` pairs (`scriptPlayback.ts:348-359`).
- `building-factory` gains one `as: "factory"` span from its `StartBuilding` to its `StopBuilding` (`:399-400`).
- `firing` replaces its two `Shot1` events with `{ engine: "fire", weapon: 1 }` on the same frames.

The scrubber marks `flare` and `shot`, reading "Flare from flare1" and "Shot, weapon 1 from flare1". It does not mark `nano`, because a build span records one on every frame and would bury the other marks. The `StartBuilding` call-in already shows where a span starts.

## 2. Emissions, resolved once per timeline

A new module, `src/lego/effects.ts`, turns the outputs into emissions. An emission is one thing that spawns particles, with everything it needs held as plain numbers:

```ts
interface Emission {
  kind: "nano" | "flame" | "tracer" | "smoke" | "vtol" | "wake" | "puff" | "burst",
  birth: number, // frame
  at: Vec3, // world space
  dir: Vec3, // world space, unit length
  to?: Vec3, // nano and tracer: where it goes
  seed: number,
  // kind-specific values: colour, variant (white or black smoke, builder or factory nano)
}
```

**Where.** An output on frame N is placed with the pose of frame N - 1. In the engine the script runs before that frame's animation ticks, the same reason `releasePoint` uses N - 1. The known limit is that a `turn ... now` in the same thread just before an `emit-sfx` is missed. The code records this in one line.

- `sfx` uses the emit vertex rule. The vertices are the ones the export writes for that piece, so an empty lego piece emits from its origin along +Z, as it will in the game.
- `nano` and `flare` use the piece origin.
- `shot` uses the emit vertex of the piece `QueryWeapon` named.

**Towards what.**

- Nano goes to the stand-in's centre, which is the buildee's `midPos`. Its jitter radius is half the stand-in's radius, as `Builder.cpp:353` passes it.
- The flame faces the aim direction the resolver computed for the most recent `AimWeapon` (`aimResolver.ts`), which is the engine's `wantedDir`.
- The tracer runs from the muzzle to the stand-in.
- An `sfx 2048 + n` tracer runs along the emit direction instead, because the engine aims it one elmo along that direction.

**Caching.** Posing the scene once for each frame that emits costs at most 450 poses. It is done once per timeline, using the scene-posing helper that moves out of `releasePoint` so both share it, and is cached in a `WeakMap` keyed by timeline. The cache is also dropped when the scene's geometry changes, because an emit point reads the piece's vertices.

## 3. Particles as a pure function of the frame

`particlesAt(emissions, frame)` returns a flat `Float32Array` of particles: centre, half-size, RGBA, texture slot and a blend flag. It holds no state between calls.

- Each kind is a closed form of `frame - birth`, or a replay from birth that never runs longer than the particle's own lifetime (smoke's size growth has a catch-up term, so it replays, capped at 60 steps).
- The engine's `guRNG` draws come from a small integer hash of `(seed, particle index, draw index)`. `Math.random` is never used. So the same frame always gives the same particles, whatever order the frames were visited in.
- Emissions near the end of the preview are cut when playback loops. Nothing carries over from frame 449 to frame 0.

Each kind, with where its numbers come from:

- **Nano, builder and factory.** Motion, jitter and lifetime from `ProjectileHandler.cpp:670-746`. Drawn TA style: opaque, alpha 1, normal blending, no bitmap, a hard-edged square dot. Colour is `nanoColor` (0.2, 0.7, 0.2) with a seeded per-particle variation in brightness, both lighter and darker, with the occasional near-white highlight, as the user's TA screenshots show. TA's source is not available, so the dot size and the amount of variation have no engine value. They are set by eye against the user's TA screenshots, starting from Recoil's draw radius of 3, and the code labels both as by-eye choices.
- **Muzzle flame.** `CMuzzleFlame` as written (`MuzzleFlame.cpp:25-102`): smoke quads and flame quads, `numFlame` and `numSmoke` from size, and the fade and draw size by age. The size comes from the weapon def defaults, damage 1 (`WeaponDef.cpp:417`) and area of effect 8, stored as 4 after its 0.5 scale (`:71`). That makes the size 0.003 and the flame 4 frames long. A real weapon's flame is longer, and the unit def follow-on makes it exact.
- **Tracer.** A short bright streak from the muzzle to the target. Its speed and length are a preview choice, not an engine value, and the code says so. It is drawn with the `laserfalloff` bitmap if the game has one.
- **Smoke, 257 and 258.** `CSmokeProjectile` (`SmokeProjectile.cpp:46-98`) with the arguments from `UnitScript.cpp:694-699`. There is no wind in the preview, so the wind term is 0. One of the game's smoke bitmaps is picked by the seeded hash, as `textureNum` is.
- **VTOL, 0.** `CHeatCloudProjectile` (`HeatCloudProjectile.cpp:48-94`) with the speed formula from `UnitScript.cpp:701-718`. The unit's own speed is 0 because the preview unit does not move. Uses the `heatcloud` bitmap.
- **Wake, 2 to 5.** `CWakeProjectile` with the arguments from `UnitScript.cpp:653-676`. The preview's ground plane counts as sea level for the `IsInWater` check, because a unit whose script emits wakes is one that sits in water. Hover craft use different alpha values (`:645-649`), which depend on the move def the editor does not have. The preview uses the ship values and says so in the code. Uses the `wake` bitmap.
- **Unit and global CEG, 1024 + n and 16384 + n.** A neutral puff: one expanding, fading quad with the `explo` bitmap along the emit direction. The panel note names it as a stand-in for the game's effect.
- **Fire weapon, 2048 + n.** The tracer, along the emit direction.
- **Detonate weapon, 4096 + n.** A neutral burst, the same puff larger.
- **Bubble, 259.** Not drawn, because it pins under sea level, which puts it under the ground plane.

## 4. Drawing

A new module, `src/lego/pages/components/effectsLayer.ts`, owns one `THREE.Mesh` of camera-facing quads with a `ShaderMaterial`.

- The quads are expanded in the vertex shader from the particle centre and the camera's right and up axes. So orbiting the camera, which re-renders without a frame change, needs no rebuild.
- Two draw calls. Particles with the engine's blend use `CustomBlending` with `OneFactor` and `OneMinusSrcAlphaFactor`, depth test on, depth write off. The TA nano dots use normal blending with alpha 1.
- One canvas atlas holds every bitmap the layer uses, as the engine's projectile atlas does, so each draw call binds one texture.

`placeEffects(state, timeline, frame)` sits beside `placeStandIn` in both callers in `useScriptFrameStepping.ts`. It fills the buffers from `particlesAt` and marks them for upload.

An "Effects" toggle sits with the stand-in toggle in `BuilderPage.tsx`, persisted through `src/lego/panels.ts`.

## 5. Bitmaps from the unit's game

A project with `imported.game` (`model.ts:149-161`) knows its game's primary archive.

1. Evaluate `gamedata/resources.lua` through `unitsync_lua_exec` with that archive mounted. Fall back to `resources.tdf` through the base content's own parser, as the engine does.
2. Read `projectiletextures` and the smoke array from the result.
3. Fetch each bitmap the layer uses, `bitmaps/<name>`, with `unitsyncArchiveExtract`.
4. Decode them through the same path the unit's own `.tga` and `.dds` textures take on import.
5. Pack them into the atlas.

Holding them in memory for the life of the open project is enough.

Any bitmap that is missing, and every bitmap for a project with no game, falls back to a procedural soft round sprite. The panel says so once, naming the missing bitmaps. That matches the engine, which also draws something rather than nothing. The TA nano dots need no bitmap, so they look the same with or without a game.

Whether `unitsyncArchiveExtract` reads through the game's dependencies, or only its primary archive, is checked when this is built. If it reads only the primary, the loader walks the dependency list itself.

## 6. Notes in the panel

- `EFFECTS_NOTE` narrows to "Explode debris and sounds are marked on the scrubber, not drawn.", given only when the run recorded an `explode` or a `sound`.
- "CEGs are drawn as a plain puff. The game's own effect needs its definition.", given when a CEG was emitted.
- "Bubbles are not drawn, because they sit under the water line.", given when a bubble was emitted.
- "The script named no nano piece." and "The script named no weapon piece.", given for a `null` output.
- The missing bitmaps note from section 5.

## Not in scope

- Reading the unit definition. The unit's `nanoColor`, the weapon's damage, area of effect and type, and the names of its generators all need it.
- Real CEGs. They need the unit definition, the game's CEG tables, a dozen or so particle classes with their operator language, and the bitmaps they name.
- Debris from `Explode`.
- Reclaim, resurrect and capture spray, which run inverse or from other call sites.
- Team colour nano spray, which is a player setting (`teamNanospray`).
- Sound.

## Testing

1. Both runtimes run a small script that shows a flare in `FirePrimary`, shows a piece in any other function, and answers `QueryWeapon1` and an alternating `QueryNanoPiece`. They must produce the same `events`, and the flare piece must stay hidden. This extends the parity test in `bos2lua_parity.rs`.
2. A Rust test of the nano cache rule. An alternating script is asked until 30 cached answers in a row, then asked no more, and the seeded pick only ever names the pieces it saw.
3. `effects.test.ts`:
   - emit points for an empty piece, a one-vertex piece and a two-vertex piece, against the engine rule
   - N - 1 placement
   - the sfx number table, including the order of the bit tests
4. `particlesAt` tests:
   - the same frame twice gives identical arrays
   - visiting frames in a different order does not change any frame
   - a builder nano particle arrives at the target on frame `birth + floor(len / 3)`
   - smoke's size matches a direct replay of `CSmokeProjectile::Update`
5. `ModelViewport.dom.test.tsx` covers the layer appearing for a timeline with emissions, hiding with the toggle, and the buffers changing with the frame.
6. A resources test against a stub `unitsync_lua_exec` result: names resolve to `bitmaps/` paths, and a missing name falls back and is reported.
7. On screen, through the Tauri MCP on a seeded portable instance, following "Driving the app" in `CLAUDE.md`:
   - a Balanced Annihilation construction unit under `building`: a stream of opaque green dots from its nozzle to the stand-in, from both nozzles if its script alternates
   - a factory under `building-factory`
   - a unit with a flare under `firing`
   - scrubbing back and forth over one frame shows the same picture each time

## Delivery

Three PRs, in this order:

- A. Nano. The `build` action and `nano` output in both runtimes, `effects.ts`, `particlesAt`, the layer and the toggle, drawn TA style. No bitmaps yet, because nano needs none. M.
- B. Firing and bitmaps. The `flare` and `shot` outputs, the `show` fix, the `fire` action, the flame and the tracer, and the bitmap loading in section 5. M.
- C. Built-in sfx. Smoke, VTOL, wake, the CEG puff and burst, and the panel notes. M.

L in total.

## Follow-on projects

- **The unit definition in the editor.** A project imported from a game reads its unit def: `nanoColor`, each weapon's damage, area of effect and type, and `sfxtypes.explosiongenerators`. The flame then gets its real size, the tracer its real weapon type, and the scrubber the generator's name. The unitsync worker already parses unit defs for the workshop (`crates/coilbox-unitsync-worker/src/unitdefs.rs`).
- **CEGs from the game.** Parse the game's CEG tables, port the particle classes they use, and draw the real effect in place of the puff. This needs the unit definition project first.
- **Explode debris.** Throw the piece's own geometry along the flags' rules.
