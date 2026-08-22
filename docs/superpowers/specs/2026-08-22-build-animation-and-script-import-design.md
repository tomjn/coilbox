# Build animation and script import

2026-08-22. Design for two features in the lego unit builder: animation presets for units that build, and reading an imported game unit's own animation script well enough to adopt it and propose piece roles from it.

They are written as one spec because the second one supplies the first. A game builder's script is where the nano pieces and the arm are named, so the same run that adopts a script can fill in the roles the build presets need.

Every engine fact below was read out of the RecoilEngine checkout, cited by file and line, rather than recalled.

## What is wrong today

A unit exported from the lego builder cannot build. Two separate things stop it.

`buildUnitDef` writes a deliberately static skeleton: `canmove = false`, no `builder`, no `workerTime`, no `buildDistance`, no `canAssist` (`src/lego/unitDef.ts:119-145`). So the unit definition never claims the unit is a builder at all.

Behind that, even a unit whose definition does claim it sits waiting. `CBuilder::StartBuild` bails when the unit is not in build stance:

```cpp
if ((inWaitStance = !ScriptStartBuilding(buildInfo.pos, true)))
    return false;
```

`ScriptStartBuilding` returns `unit->inBuildStance` (`Builder.cpp:942-960`). The only writer of that field anywhere in the engine is a script calling `SetUnitValue(COB.INBUILDSTANCE, n)` (`UnitScript.cpp:1581`), and it is initialised false in `Unit.h:502`. Coilbox never emits it, so a builder queues a build and waits forever with no error and nothing in the infolog.

There is a third, smaller problem. The existing Build arm preset hooks `Activate` and `Deactivate`, which mean "switched on", not "building". A builder is switched on nearly all the time, so the arm sweeps constantly and stops for nothing.

## Engine facts this is built on

| Fact | Source |
| --- | --- |
| A builder gets `StartBuilding(heading, pitch)`, radians, relative to its own facing, recomputed from the build target on every call | `Builder.cpp:942-955` |
| A factory gets `StartBuilding()` with no arguments, once when a build begins, and `StopBuilding()` when it ends | `Factory.cpp:197`, `Factory.cpp:314` |
| Both are thread-wrapped, so `Turn`, `WaitForTurn` and `Sleep` are legal inside them | `unit_script.lua:66-67` |
| `QueryNanoPiece` is commented out of `thread_wrap`, so it must return immediately and may not wait | `unit_script.lua:68` |
| Build stance is written only by the script | `UnitScript.cpp:1581` |
| A unit's script file is the unitdef's `script` key, resolved under `scripts/` by exact match, basename match, then both again with `.cob` swapped for `.lua` | `unit_script.lua:558-567` |

The asymmetry in the first two rows is the reason "aim" means different things here. A builder points at something outside itself. A factory builds inside itself and the engine hands it nothing to point at, so a factory preset animates opening and closing rather than aiming.

## Part 1: Build presets

### One new role

`buildarm.nano`, labelled "Nano emit point", in the existing Build arm group. It may be set on many pieces at once.

On a game model these are usually empty pieces named `nano1`, `nano2` and so on, carrying no geometry and existing only as coordinates for the build spray. Coilbox already makes empty pieces (`BuilderPage.tsx:1186`, "Add an empty piece, which is how flares and aim points are made") and `model.ts:199` already describes a piece with no part as "a hierarchy node, flare, aim point or emitter", so a unit built from parts can have them too.

Separate from the existing `buildarm.nozzle` because they are different jobs. The nozzle is a part that swings and gets counter-rotated by the Build arm preset. A nano point never moves and is only ever a coordinate.

### Generator changes

Three callins join the `HOOKS` list in `luaScript.ts`, so every unit writes them the way it already writes the other nine:

```lua
function script.StartBuilding(heading, pitch)
function script.StopBuilding()
function script.QueryNanoPiece()
```

`QueryNanoPiece` needs a `HOOK_FALLBACK` returning the root piece, the same shape as `AimWeapon1`'s existing `return true`, because it must return a piece whether or not any preset filled it in.

Writing `StartBuilding` for every unit sets `hasStartBuilding` true on every unit (`LuaUnitScript.cpp:62`). That is only meaningful to a builder, and for a builder it is required rather than merely harmless, because the build stance line lives inside it.

### Build stance, always

Not a preset. A hardcoded block, like the `Explode` line already hardcoded into `Killed`:

- `StartBuilding` always ends with `SetUnitValue(COB.INBUILDSTANCE, 1)`, after any preset lines.
- `StopBuilding` always begins with `SetUnitValue(COB.INBUILDSTANCE, 0)`, before any preset lines.

The ordering is the point. An aim preset's `WaitForTurn` has to finish before the unit declares itself in stance, or it builds while still swinging.

This is emitted for every unit, not only for units with a build arm role. A unit can be a builder in its definition without having modelled an arm, and gating on the role would leave that unit silently broken in exactly the way this fixes.

### The four presets

**Aim while building** (`build.aim`). Requires `buildarm.arm`. Animates `buildarm.base` and `buildarm.arm`. Parameters: turn speed and lift speed, both degrees per second, defaulting to 120 and 90.

```lua
function script.StartBuilding(heading, pitch)
  if heading then
    Turn(arm_base, y_axis, heading, math.rad(120))
    Turn(arm, x_axis, -pitch, math.rad(90))
    WaitForTurn(arm_base, y_axis)
    WaitForTurn(arm, x_axis)
  end
  SetUnitValue(COB.INBUILDSTANCE, 1)
end
```

The `if heading` guard is because a factory calls the same function with no arguments. Without it a unit carrying both this and the factory preset throws on every build.

`StopBuilding` turns both pieces back to zero at the same speeds.

The sign on pitch needs checking against a running engine before this is called done. The engine computes `p - pitch` from `asin` of the target direction against `updir` (`Builder.cpp:947-954`), positive meaning the target is above the builder, and the `-pitch` above assumes Spring's `Turn` on `x_axis` is positive nose-down. That matches the common convention in hand-written scripts but has not been verified here.

**Factory build cycle** (`build.factory`). Requires `door`. Animates `door`. Opens the doors on `StartBuilding()` and holds them, then closes them on `StopBuilding()`. Parameters: open angle and open time.

No aiming, because the engine hands a factory nothing to aim at.

**Nano from the nozzle** (`build.nano`). Requires at least one `buildarm.nano`. Animates nothing: it contributes no motion, only a return value.

```lua
local nanoPieces = { nano1, nano2 }
local nanoIndex = 0

function script.QueryNanoPiece()
  nanoIndex = nanoIndex % #nanoPieces + 1
  return nanoPieces[nanoIndex]
end
```

Cycling rather than returning one piece is what a multi-nozzle builder does, and it is why the role takes many pieces. With no preset applied the fallback returns the root piece, which on a tall builder puts the spray somewhere near its feet.

**Build arm** (existing, changed). Its hooks move from `Activate`/`Deactivate` to `StartBuilding`/`StopBuilding`, so it sweeps while working rather than while merely switched on.

This changes behaviour for units that already apply it. The preset's description says so, and the docs note it.

### Known interaction

Doors and Factory build cycle both animate the `door` role, on different callins. A unit with both applied opens its doors while building and also cycles them while merely active. Both are allowed and the panel says so. Building a mechanism to prevent it is not worth the code.

### Unit definition

A unit with any `buildarm.*` role gets builder keys written into its definition: `builder`, `workerTime`, `buildDistance` and `canAssist`. Work rate and build distance get sliders in the panel, and `canAssist` defaults true.

Without this the presets animate a unit that can never build, which is the state today. The unit definition is written once and then left alone by every later export, so this only ever affects a first export.

### Preview

A `building` scenario joins `SCENARIOS` in `scriptPlayback.ts`: create, aim one way and build, stop, aim the other way and build. That covers a unit whose script is its own, which is what scenarios drive.

A preset-driven unit previews through `track(t)`, which is a pure function of time, so each build preset also gets a `track` playing that same shape on a loop. Both modes then show the same motion.

Neither pretends the timing is the unit's. A game decides when a builder starts and stops, and the preview is a demonstration in the same way the existing turret sweep is.

## Part 2: Reading an imported unit's script

### Finding the file

An imported unit already records the archive, the member and the unitdef name (`model.ts:149-161`).

Resolution mirrors the framework's own walk (`unit_script.lua:558-567`): read the unitdef's `script` key, defaulting to `<unit>.cob`, then look under `scripts/` for an exact match, a basename match, and both again with `.cob` swapped for `.lua`.

Both halves already exist. Coilbox evaluates a game's `defs.lua` inside the mounted archive to read unitdef fields (`crates/coilbox-unitsync-worker/src/dataset.rs`), so asking for one more field is nearly free, and the worker already extracts a single archive member with `--archive --file --extract`.

### What happens to it

A Lua script is adopted as the unit's own, stored in `project.script`. It is then editable in the script drawer and written by an export, exactly like a script somebody took over by hand. The drawer says which game and which unit it came from.

A COB script is decoded and disassembled to BOS by `tauri-plugin-coilbox-anim` and shown read-only, marked as not exportable because it is not Lua and coilbox writes Lua.

Adoption is not silent: import reports it, and the existing "Discard this script and use the presets" button in the script drawer is the way back to preset-driven animation.

### Inferring roles

`crates/coilbox-springlua/src/unitscript.rs` already runs a unit script in a sandbox: it resolves `piece(name)` to indices, executes `Turn`, `Move` and `Spin`, drives callins by name from a plain string, and reports calls it does not model rather than faking them. Asking a script which piece is its nano point is therefore not a parse. It is calling the function and reading the answer.

Two tiers, kept apart in the interface because they differ in kind.

**Stated.** The script returns the piece. This is its own answer.

| Callin | Role |
| --- | --- |
| `QueryNanoPiece()`, called repeatedly to catch a cycle | `buildarm.nano` |
| `AimFromWeapon1()` | `aim` |
| `QueryWeapon1()` | `flare` |

**Observed.** Drive a callin and watch what moves.

| Driven | What happens | Role |
| --- | --- | --- |
| `AimWeapon1(h, p)` | turns on y | `turret` |
| `AimWeapon1(h, p)` | turns on x | `barrel` |
| `StartBuilding(h, p)` | turns on y, then on x | `buildarm.base`, `buildarm.arm` |
| `StartMoving()` | spins | `wheel` |

Legs are deliberately excluded. Which of six moving pieces is the front left shin is not something motion reveals, and a wrong leg role is worse than no role, because the presets then animate the unit inside out.

### How proposals reach the tree

Never applied silently. The import result lists one row per piece with the role found and the callin it came from as the evidence, and the roles are taken all, some or none. A role already set by hand is never overwritten.

### What the runner needs

One addition: a probe mode that calls a callin directly and returns its return value, mapped from piece index back to piece name. The runner currently starts every callin as a coroutine and keeps only the poses, so a return value is discarded. It already holds `pieces: Vec<String>` and a `piece_index` lookup, so the mapping is there.

No callin list to extend: callins are already looked up by string on the script table.

### Limits

- Lua only. Inferring from COB would need a BOS interpreter on top of the existing disassembler, which is a much larger job than the disassembler was, and is not in this spec.
- A script that picks its nano piece from world state gets whatever the sandbox's answer is, which may be one of several valid ones. Calling it repeatedly and taking the union is the mitigation, not a fix.
- Piece names must match. An imported model and its own script always agree, so this only breaks when a model is pointed at a different unit's script.
- The runner reports unknown calls rather than faking them, so a script leaning on engine state coilbox does not model infers less rather than inferring wrong. That is the intended failure direction.

## Testing

Pure-module tests on the emitted Lua, in the shape `pieceCollisionScript.test.ts` already uses:

- build stance emitted for every unit, in the right place in both callins
- the aim body guarded, so a factory calling with no arguments does not throw
- nano cycling correct for one, two and many nano pieces, and the root-piece fallback with none
- the whole generated script compiling through `coilbox-springlua`, the way `luaScript.test.ts` already checks

Role inference gets fixture scripts driven through the runner:

- a builder with three nano pieces, expecting all three
- a turreted unit, expecting turret and barrel from `AimWeapon1`
- a unit that infers nothing, expecting no proposals rather than an error
- a script calling something the sandbox does not model, expecting fewer proposals and a reported note

The unit definition gets a test that builder keys appear only when a build arm role exists.

## What cannot be verified here

The engine does not run on this machine: it launches and exits with no OpenGL context. So none of the following is checkable before it ships, and the implementation must say so rather than imply otherwise:

- that a builder with these keys and this script actually enters build stance and completes a build
- the sign of the pitch argument in the aim preset
- that nano spray visibly comes from the nano pieces

Headless verification through `spring-headless` covers script loading and callin binding, which is what the existing engine load checklist in `docs/lego-builder.md` already does. It does not cover any of the three above.

## Out of scope

- Weapons in the unit definition. A builder needs no weapon and the definition still writes none.
- `QueryBuildInfo`, which places the build preview, and the terraform callins.
- Inferring leg roles, for the reason given above.
- Any use of the disassembled BOS beyond reading it.
