# Built-in sfx in the preview effects renderer, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a unit script calls `emit-sfx`, the model editor's preview draws the engine's smoke, VTOL heat cloud and wake, a neutral puff for a CEG, a larger burst for a weapon detonation, and a tracer for a weapon fired from a piece, and the panel says what it cannot draw.

**Architecture:** Both runtimes already record `{ kind: "sfx", piece, sfx }`. `effectsPlayback.ts` resolves each one to a world-space emission once per timeline, at the piece's emit vertex on the pose of frame N - 1, through a new pure `sfxEmission` in `effects.ts` that reads the number in the engine's order. `effects.ts` turns each new kind into sprites as a closed form of its age (smoke replays at most its own 60 frame life). The sprite shader gains a fixed side direction so a wake can lie flat on the ground. The Rust `finish` step narrows the effects note and adds the CEG and bubble notes.

**Tech Stack:** Rust (coilbox-unitpose, tauri-plugin-coilbox-anim tests), TypeScript, three.js, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-effects-renderer-design.md`, PR C in "Delivery", sections 2, 3, 5 and 6. Read them before starting any task.

## Global Constraints

- Engine facts come from `~/dev/RecoilEngine`. Cite the file and line in a comment where code ports engine behaviour.
- A number with no engine source is labelled in code as set by eye and tuned with the user on screen.
- Do not change the nano constants in `src/lego/effects.ts` (`NANO_DOT_HALF_SIZE`, `NANO_BRIGHTNESS_SPREAD`, `NANO_DOTS_PER_FRAME`, `NANO_SPREAD`, `NANO_HIGHLIGHT_CHANCE`, `NANO_HIGHLIGHT_MIX`) or how nano is drawn. Do not change the tracer's look (`TRACER_*` constants, `TRACER_PALETTE`, `tracerSprites`).
- Comments, docs and commit messages: no em dashes, no semicolons (a hook blocks them). Plain English, sentence case.
- `Math.random` is never used in effects code. Random draws come from `unitFloat(seed, draw)` and `ballPoint(seed, first)`.
- three.js caches an instanced geometry's max instance count at first render. Growing a buffer means a new geometry.
- Rust: run `cargo fmt --all` rather than hand-formatting.
- Commit after each task with `git add <explicit paths>`. Never `git add -A`. Never amend.
- Do not run `git checkout`, `git switch`, `git rebase`, `git pull` or `git push`. Check `git branch --show-current` prints `effects-sfx` before each commit.

## Engine facts every task relies on

- `CUnitScript::EmitAbsSFX` (`rts/Sim/Units/Scripts/UnitScript.cpp:626-800`) switches on the exact numbers first: 4 and 5 reverse wake (`:653`), 2 and 3 wake (`:665`), 259 bubble (`:678`), 257 and 258 smoke (`:693-698`), 0 VTOL (`:700-717`). Only then, in `default`, does it test the range bits in this order: 16384 global CEG (`:721`), 1024 unit CEG (`:736`), 2048 fire weapon (`:752`), 4096 detonate weapon (`:788`). So `1024 + 257` is a CEG, `16384 + 2048` is a global CEG and `2048 + 4096` fires a weapon. Numbers from `CobDefines.h:9-20`.
- `EmitSfx` takes the emit position and direction from `GetEmitDirPos`, normalises the direction (`UnitScript.cpp:597-617`), and turns both into world space with the unit's axes (`GetObjectSpaceVec`, `SolidObject.h:232`). The preview's unit never moves or turns and the preview's world space is the model's own space, so the piece's world matrix gives both directly.
- Particles made during a unit's script run are updated by the projectile handler later the same frame, before drawing. On frame `birth + k` a particle has had `k + 1` updates. PR B's `flameSprites` uses the same rule.
- Wakes are only emitted when the unit is in water (`UnitScript.cpp:634`). The spec counts the preview's ground as sea level, so the preview always draws them. Hover craft use other alpha values (`:645-649`) that depend on a move def the editor does not have, so the preview uses the ship values.
- Particle bitmaps: the engine names them `explo`, `heatcloud` and `wake` in `gamedata/resources.lua` (`ProjectileDrawer.cpp:212-219`). The base content maps `heatcloud` to `explo.tga` and `wake` to `wake.tga` (`cont/base/springcontent/gamedata/resources.lua:103-107`).

## Decisions taken while planning

1. `sfx 2048 + n` draws the PR B tracer, weapon `n + 1`, along the emit direction for `SFX_TRACER_RANGE` elmos. The engine aims it one elmo ahead (`UnitScript.cpp:768`), which would draw nothing visible, and the weapon's real range needs the unit def. The range is set by eye. It needs no stand-in, so it draws in every scenario.
2. The CEG puff and detonation burst are one sprite kind, `puff` and `burst`, with the `explo` bitmap and heat cloud colouring (brightness by age, alpha 1/255), since the engine has no source for either. Every number is set by eye.
3. A wake lies on the preview's ground plane, lifted `WAKE_LIFT` elmos so it does not flicker against the ground, which sits at the same height. Set by eye.
4. The VTOL heat cloud's speed is the engine's `unit->speed * 0.7 + GetObjectSpaceVec(0.5 * relDir.x, -0.5 * |relDir.y|, 0.5 * relDir.z)` with a unit speed of 0 (`UnitScript.cpp:701-717`). The engine writes it with `frontdir`, `updir` and `rightdir`, which is `GetObjectSpaceVec` spelled out, so in the preview it is `0.5 * (d.x, -|d.y|, d.z)` with `d` the world emit direction.
5. The CEG and bubble notes are said by the Rust `finish` step, next to `EFFECTS_NOTE`, so both runtimes say them. The "named no nano piece" and "named no weapon piece" notes already exist.

## File structure

- `crates/coilbox-unitpose/src/lib.rs`: narrowed `EFFECTS_NOTE`, new `CEG_NOTE` and `BUBBLE_NOTE`, `sfx_is_ceg`.
- `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`: one test's expectation moves to `CEG_NOTE`.
- `src/lego/effects.ts`: new bitmap slots, `sides` on sprites, smoke, VTOL, wake, puff and burst emissions and sprites, `sfxEmission`.
- `src/lego/effectBitmaps.ts`: `heatcloud`, `explo` and `wake` bitmaps.
- `src/lego/pages/components/effectsLayer.ts`: the `side` attribute and a flat quad in the sprite shader.
- `src/lego/pages/components/effectsPlayback.ts`: resolving `sfx` outputs.
- Tests beside each: `effects.test.ts`, `effectBitmaps.test.ts`, `effectsLayer.dom.test.ts`, `ModelViewport.dom.test.tsx`.

---

### Task 1: Panel notes for what is still not drawn

**Files:**
- Modify: `crates/coilbox-unitpose/src/lib.rs` (`EFFECTS_NOTE` at :25-27, `ScriptOutput::is_effect` at :220-227, `Model::finish` at :688-700, tests module from :790)
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs:1064-1086`

**Interfaces:**
- Produces, in `coilbox_unitpose`:
  - `pub const EFFECTS_NOTE: &str = "Explode debris and sounds are marked on the scrubber, not drawn.";`
  - `pub const CEG_NOTE: &str = "CEGs are drawn as a plain puff. The game's own effect needs its definition.";`
  - `pub const BUBBLE_NOTE: &str = "Bubbles are not drawn, because they sit under the water line.";`
  - `pub fn sfx_is_ceg(sfx: i32) -> bool`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module at the bottom of `crates/coilbox-unitpose/src/lib.rs`, after `nano_alone_does_not_say_effects_are_not_drawn`:

```rust
    /// Built-in sfx are drawn now, so an sfx on its own no longer brings the
    /// note that effects are not.
    #[test]
    fn a_built_in_sfx_does_not_say_effects_are_not_drawn() {
        let mut model = placed();
        model.emit_sfx(0, 2, 257);
        let mut timeline = Timeline::new(names(), 0);
        model.finish(&mut timeline);
        assert!(!timeline.warnings.iter().any(|w| w == EFFECTS_NOTE));
        assert!(!timeline.warnings.iter().any(|w| w == CEG_NOTE));
    }

    #[test]
    fn an_explosion_says_debris_is_not_drawn() {
        let mut model = placed();
        model.explode(0, 2, 1);
        let mut timeline = Timeline::new(names(), 0);
        model.finish(&mut timeline);
        assert!(timeline.warnings.iter().any(|w| w == EFFECTS_NOTE));
    }

    #[test]
    fn a_ceg_says_it_is_drawn_as_a_puff_once() {
        let mut model = placed();
        model.emit_sfx(0, 2, 1024 + 3);
        model.emit_sfx(1, 2, 16384 + 1);
        let mut timeline = Timeline::new(names(), 0);
        model.finish(&mut timeline);
        assert_eq!(
            timeline.warnings.iter().filter(|w| *w == CEG_NOTE).count(),
            1
        );
    }

    #[test]
    fn a_bubble_says_it_is_not_drawn() {
        let mut model = placed();
        model.emit_sfx(0, 2, 259);
        let mut timeline = Timeline::new(names(), 0);
        model.finish(&mut timeline);
        assert!(timeline.warnings.iter().any(|w| w == BUBBLE_NOTE));
        assert!(!timeline.warnings.iter().any(|w| w == CEG_NOTE));
    }

    /// The engine's switch takes the exact built-in numbers before it tests
    /// any range bit, and the global CEG bit before the unit CEG bit
    /// (`UnitScript.cpp:651-750`).
    #[test]
    fn reads_a_ceg_in_the_engines_order() {
        assert!(sfx_is_ceg(1024));
        assert!(sfx_is_ceg(16384 + 5));
        assert!(sfx_is_ceg(1024 + 257));
        assert!(sfx_is_ceg(2048 + 1024));
        assert!(sfx_is_ceg(16384 + 2048));
        assert!(!sfx_is_ceg(257));
        assert!(!sfx_is_ceg(0));
        assert!(!sfx_is_ceg(2048));
        assert!(!sfx_is_ceg(4096 + 2048));
    }
```

In `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`, `records_an_effect_on_its_piece_and_frame` emits sfx 1025, a unit CEG. Replace its `EFFECTS_NOTE` assertion (lines 1078-1081) with:

```rust
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w == coilbox_unitpose::CEG_NOTE));
        assert!(!timeline
            .warnings
            .iter()
            .any(|w| w == coilbox_unitpose::EFFECTS_NOTE));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p coilbox-unitpose 2>&1 | tail -20`
Expected: compile errors, `CEG_NOTE`, `BUBBLE_NOTE` and `sfx_is_ceg` not found.

- [ ] **Step 3: Implement**

Replace the `EFFECTS_NOTE` doc comment and value at `lib.rs:25-27` with:

```rust
/// Said once when a run recorded an explosion or a sound, which the preview
/// marks on the scrubber but neither draws nor plays.
pub const EFFECTS_NOTE: &str = "Explode debris and sounds are marked on the scrubber, not drawn.";

/// Said once when a run emitted a unit or global CEG. The preview draws it as
/// a plain puff, because the real effect is defined by the game.
pub const CEG_NOTE: &str =
    "CEGs are drawn as a plain puff. The game's own effect needs its definition.";

/// Said once when a run emitted bubbles. The engine pins them just under sea
/// level (`BubbleProjectile.cpp:68-71`), which is under the preview's ground.
pub const BUBBLE_NOTE: &str = "Bubbles are not drawn, because they sit under the water line.";

/// The sfx numbers the engine's switch matches exactly, before it tests any
/// range bit (`rts/Sim/Units/Scripts/CobDefines.h:9-16`, `UnitScript.cpp:651-717`).
const BUILT_IN_SFX: [i32; 8] = [0, 2, 3, 4, 5, 257, 258, 259];
const SFX_BUBBLE: i32 = 259;
/// The unit and global CEG range bits (`CobDefines.h:17,20`).
const SFX_CEG: i32 = 1024;
const SFX_GLOBAL: i32 = 16384;

/// Whether an sfx number emits a CEG. The engine tests the global CEG bit and
/// then the unit CEG bit before the weapon bits, and only for a number that is
/// not one of the built-in ones (`UnitScript.cpp:719-750`).
pub fn sfx_is_ceg(sfx: i32) -> bool {
    !BUILT_IN_SFX.contains(&sfx) && (sfx & (SFX_GLOBAL | SFX_CEG)) != 0
}
```

Replace `is_effect` (`lib.rs:220-227`) with:

```rust
    /// Whether this is something the preview marks but neither draws nor
    /// plays.
    fn is_undrawn(&self) -> bool {
        matches!(self, Self::Explode { .. } | Self::Sound { .. })
    }
```

In `finish`, replace the `if self.events.iter().any(ScriptOutput::is_effect) { ... }` block with:

```rust
        if self.events.iter().any(ScriptOutput::is_undrawn) {
            timeline.warnings.push(EFFECTS_NOTE.to_string());
        }
        let sfx_numbers = || {
            self.events.iter().filter_map(|event| match event {
                ScriptOutput::Sfx { sfx, .. } => Some(*sfx),
                _ => None,
            })
        };
        if sfx_numbers().any(sfx_is_ceg) {
            timeline.warnings.push(CEG_NOTE.to_string());
        }
        if sfx_numbers().any(|sfx| sfx == SFX_BUBBLE) {
            timeline.warnings.push(BUBBLE_NOTE.to_string());
        }
```

Update `finish`'s doc comment to: "Close a timeline off: carry the warnings and events over, say once for each kind of output the preview cannot draw, and drop the visibility track when nothing ever used it."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo fmt --all && cargo test -p coilbox-unitpose -p tauri-plugin-coilbox-anim -p coilbox-springlua 2>&1 | grep -E "test result|FAILED|panicked"`
Expected: every `test result: ok`. The springlua test at `unitscript_tests.rs:2670` records sounds, so it still sees `EFFECTS_NOTE`.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitpose/src/lib.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Say which script outputs the preview still cannot draw"
```

---

### Task 2: Heat cloud, explo and wake bitmaps

**Files:**
- Modify: `src/lego/effects.ts:105-110` (bitmap slot constants and the `Sprites.bitmaps` doc at :79-81)
- Modify: `src/lego/effectBitmaps.ts` (`RESOURCES_LUA` at :34-81, `BitmapFile.key` doc at :84, `slotOf` at :129-138)
- Test: `src/lego/effectBitmaps.test.ts`

**Interfaces:**
- Produces, in `src/lego/effects.ts`: `BITMAP_HEATCLOUD = 3`, `BITMAP_EXPLO = 4`, `BITMAP_WAKE = 5`, and `BITMAP_SMOKE` moves from 3 to 6. Smoke n stays at `BITMAP_SMOKE + n - 1`.
- `slotOf("heatcloud")`, `slotOf("explo")`, `slotOf("wake")` answer those slots.

- [ ] **Step 1: Write the failing tests**

In `src/lego/effectBitmaps.test.ts`, add `BITMAP_EXPLO`, `BITMAP_HEATCLOUD` and `BITMAP_WAKE` to the import from `./effects`, then add to the `slotOf` describe block:

```ts
  it("puts the sfx bitmaps in their own slots, before the smoke set", () => {
    expect(slotOf("heatcloud")).toBe(BITMAP_HEATCLOUD);
    expect(slotOf("explo")).toBe(BITMAP_EXPLO);
    expect(slotOf("wake")).toBe(BITMAP_WAKE);
    expect(
      new Set([
        BITMAP_MUZZLE_FLAME,
        BITMAP_LASER,
        BITMAP_LASER_END,
        BITMAP_HEATCLOUD,
        BITMAP_EXPLO,
        BITMAP_WAKE,
      ]).size,
    ).toBe(6);
    expect(BITMAP_SMOKE).toBeGreaterThan(BITMAP_WAKE);
  });
```

Add a new describe block after `slotOf`:

```ts
describe("RESOURCES_LUA", () => {
  it("asks for the heat cloud, explo and wake bitmaps, with the base content's names as defaults", () => {
    expect(RESOURCES_LUA).toContain("add('heatcloud', field(textures, 'heatcloud'))");
    expect(RESOURCES_LUA).toContain("add('explo', field(textures, 'explo'))");
    expect(RESOURCES_LUA).toContain("add('wake', field(textures, 'wake'))");
    expect(RESOURCES_LUA).toContain("heatcloud = 'explo.tga'");
    expect(RESOURCES_LUA).toContain("wake = 'wake.tga'");
  });
});
```

and add `RESOURCES_LUA` to the import from `./effectBitmaps`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/effectBitmaps.test.ts`
Expected: FAIL, the new constants are undefined and `slotOf("heatcloud")` is -1.

- [ ] **Step 3: Implement**

In `src/lego/effects.ts`, replace the slot constants and their comment at :105-110 with:

```ts
/** Which bitmap a sprite draws: `CMuzzleFlame::Draw`'s three textures, the
 *  laser's own end cap texture, the heat cloud a VTOL sfx draws, the `explo`
 *  bitmap the preview's CEG puff draws, and the wake. The smoke set comes
 *  last because its length depends on the game. */
export const BITMAP_MUZZLE_FLAME = 0;
export const BITMAP_LASER = 1;
export const BITMAP_LASER_END = 2;
export const BITMAP_HEATCLOUD = 3;
export const BITMAP_EXPLO = 4;
export const BITMAP_WAKE = 5;
export const BITMAP_SMOKE = 6;
```

and change the `Sprites.bitmaps` doc at :79-80 to: "One per sprite, a `BITMAP_*` slot, or `BITMAP_SMOKE + n` for smoke bitmap n."

In `src/lego/effectBitmaps.ts`:

1. Add `BITMAP_EXPLO`, `BITMAP_HEATCLOUD` and `BITMAP_WAKE` to the import from `./effects`.
2. In `RESOURCES_LUA`, change the default table line to:

```lua
local textures = { explo = 'explo.tga', heatcloud = 'explo.tga', wake = 'wake.tga', laserfalloff = 'laserfalloff.tga', laserend = 'laserend.tga' }
```

and update the comment above it to cite `springcontent/gamedata/resources.lua:97-112`, unchanged. After `add('laserend', field(textures, 'laserend'))` add:

```lua
add('heatcloud', field(textures, 'heatcloud'))
add('explo', field(textures, 'explo'))
add('wake', field(textures, 'wake'))
```

3. Change the `BitmapFile.key` doc to: `"muzzleflame", "laserfalloff", "laserend", "heatcloud", "explo", "wake", or "smoke1", "smoke2" and so on.`
4. In `slotOf`, after the `laserend` line, add:

```ts
  if (key === "heatcloud") return BITMAP_HEATCLOUD;
  if (key === "explo") return BITMAP_EXPLO;
  if (key === "wake") return BITMAP_WAKE;
```

and change its doc to: "The atlas slot a key goes in, one of the `BITMAP_*` slots, or `BITMAP_SMOKE + n - 1` for smoke n."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/lego/effectBitmaps.test.ts src/lego/effects.test.ts src/lego/pages/components/effectsLayer.dom.test.ts`
Expected: PASS. The existing tests use the constants, not their values.

- [ ] **Step 5: Commit**

```bash
git add src/lego/effects.ts src/lego/effectBitmaps.ts src/lego/effectBitmaps.test.ts
git commit -m "Load the heat cloud, explo and wake bitmaps for the preview"
```

---

### Task 3: Sprites that lie flat

**Files:**
- Modify: `src/lego/effects.ts` (`Sprites` at :71-92, `SpriteArrays` at :297-309, every push in `flameSprites`, `tracerEndCap`, `tracerSprites`, and the arrays in `particlesAt`)
- Modify: `src/lego/pages/components/effectsLayer.ts` (`SPRITE_VERTEX` at :60-105, `spriteGeometry` at :130-170, `update` at :303-335)
- Test: `src/lego/effects.test.ts`, `src/lego/pages/components/effectsLayer.dom.test.ts`

**Interfaces:**
- Produces: `Sprites.sides: Float32Array`, three per sprite, a world-space unit direction the quad's width runs along. Zero for every existing sprite. When set, the sprite also sets `axes` and `halfLengths`, and the quad spans `axis * halfLength` by `side * halfSize` in world space rather than turning to the camera.
- The sprite geometry gains an instanced `side` attribute, size 3.

- [ ] **Step 1: Write the failing tests**

In `src/lego/pages/components/effectsLayer.dom.test.ts`:

1. In `particles()`, add `sides: new Float32Array(),` after `axes`.
2. Give `withSprites` a fifth parameter and fill it:

```ts
function withSprites(
  count: number,
  bitmap: number,
  axis: [number, number, number] = [0, 0, 0],
  halfLength = 0,
  side: [number, number, number] = [0, 0, 0],
) {
  const axes = new Float32Array(count * 3);
  const sides = new Float32Array(count * 3);
  const halfLengths = new Float32Array(count).fill(halfLength);
  const uvRanges = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    axes.set(axis, i * 3);
    sides.set(side, i * 3);
    uvRanges.set([0, 1], i * 2);
  }
  return {
    ...particles(0),
    sprites: {
      count,
      centers: new Float32Array(count * 3),
      halfSizes: new Float32Array(count).fill(2),
      colors: new Float32Array(count * 4).fill(1),
      bitmaps: new Float32Array(count).fill(bitmap),
      axes,
      sides,
      halfLengths,
      uvRanges,
    },
  };
}
```

3. Add to the `the sprite mesh` describe block:

```ts
  it("writes a flat sprite's side onto the instanced attributes", () => {
    const layer = buildEffectsLayer();
    layer.update(withSprites(1, 0, [1, 0, 0], 5, [0, 0, 1]));
    expect(
      Array.from(spriteGeometry(layer).getAttribute("side").array).slice(0, 3),
    ).toEqual([0, 0, 1]);
    layer.dispose();
  });
```

In `src/lego/effects.test.ts`, add to `particlesAt with flames and tracers`:

```ts
  it("turns every flame and tracer sprite to the camera, with no side of its own", () => {
    const { sprites } = particlesAt(
      [
        {
          kind: "flame",
          birth: 0,
          at: [0, 0, 0],
          dir: [0, 0, 1],
          size: DEFAULT_FLAME_SIZE,
          seed: 1,
        },
        {
          kind: "tracer",
          birth: 0,
          at: [0, 0, 0],
          to: [0, 0, 100],
          seed: 2,
          weapon: 1,
        },
      ],
      2,
    );
    expect(sprites.count).toBeGreaterThan(0);
    expect(sprites.sides).toHaveLength(sprites.count * 3);
    expect(sprites.sides.every((value) => value === 0)).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/effects.test.ts src/lego/pages/components/effectsLayer.dom.test.ts`
Expected: FAIL, `sprites.sides` is undefined and the geometry has no `side` attribute.

- [ ] **Step 3: Implement**

In `src/lego/effects.ts`:

1. Add to `Sprites`, after `axes`:

```ts
  /** Three per sprite, a world-space unit direction the quad's width runs
   *  along, zero for a sprite that turns to face the camera. Only a sprite
   *  lying flat on the ground, a wake, sets it, together with `axes` and
   *  `halfLengths`. */
  sides: Float32Array;
```

2. Add `sides: number[];` to `SpriteArrays` after `axes`.
3. After every `out.axes.push(...)` in `flameSprites` (two places), `tracerEndCap` (one) and `tracerSprites` (two), add `out.sides.push(0, 0, 0);`.
4. In `particlesAt`, add `sides: [],` to the `sprites` literal after `axes: [],` and `sides: new Float32Array(sprites.sides),` to the returned sprites after `axes`.

In `src/lego/pages/components/effectsLayer.ts`:

1. In `spriteGeometry`, after the `axis` attribute, add:

```ts
  geometry.setAttribute(
    "side",
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
```

2. In `update`, after `writeSprite("axis", sprite.axes);` add `writeSprite("side", sprite.sides);`.
3. Replace `SPRITE_VERTEX`'s declarations and the `halfLength > 0.0` branch so it reads:

```glsl
attribute vec3 center;
attribute float halfSize;
attribute vec4 tint;
attribute vec4 uvRect;
attribute vec2 uvRange;
attribute vec3 axis;
attribute vec3 side;
attribute float halfLength;
varying vec4 vTint;
varying vec2 vUv;
varying vec2 vLocal;
varying float vRound;
void main() {
  vec4 view = modelViewMatrix * vec4(center, 1.0);
  if (halfLength > 0.0) {
    vec3 a = (modelViewMatrix * vec4(axis, 0.0)).xyz;
    if (dot(side, side) > 0.0) {
      vec3 s = (modelViewMatrix * vec4(side, 0.0)).xyz;
      view.xyz += a * halfLength * position.x + s * halfSize * position.y;
    } else {
      vec3 crossed = cross(a, normalize(view.xyz));
      float crossedLen = length(crossed);
      if (crossedLen > 1e-6) {
        vec3 s = crossed / crossedLen;
        view.xyz += a * halfLength * position.x + s * halfSize * position.y;
      } else {
        view.xy += position.xy * halfSize;
      }
    }
  } else {
    view.xy += position.xy * halfSize;
  }
```

leaving the rest of `main` as it is. Add to the shader's doc comment: "A sprite with a `side` as well lies in the plane of its axis and side instead, as `CWakeProjectile::Draw` lays a wake on the water (`WakeProjectile.cpp:98-108`)."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/lego/effects.test.ts src/lego/pages/components/effectsLayer.dom.test.ts src/lego/pages/components/ModelViewport.dom.test.tsx && bun run typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lego/effects.ts src/lego/effects.test.ts src/lego/pages/components/effectsLayer.ts src/lego/pages/components/effectsLayer.dom.test.ts
git commit -m "Let an effects sprite lie flat along two fixed directions"
```

---

### Task 4: Smoke, VTOL and wake particles

**Files:**
- Modify: `src/lego/effects.ts` (header comment, new emission types after `TracerEmission`, the `Emission` union, new sprite functions before `particlesAt`, dispatch in `particlesAt`)
- Test: `src/lego/effects.test.ts`

**Interfaces:**
- Consumes: `BITMAP_HEATCLOUD`, `BITMAP_WAKE`, `BITMAP_SMOKE` (Task 2), `Sprites.sides` and `SpriteArrays.sides` (Task 3), `unitFloat`, `ballPoint`.
- Produces, exported from `src/lego/effects.ts`:

```ts
export interface SmokeEmission {
  kind: "smoke";
  birth: number;
  at: Vec3;
  /** 0.5 for white smoke (257), 0.6 for black (258). */
  color: number;
  seed: number;
}
export interface VtolEmission {
  kind: "vtol";
  birth: number;
  at: Vec3;
  /** The emit direction, world space, unit length or zero. */
  dir: Vec3;
  seed: number;
}
export interface WakeEmission {
  kind: "wake";
  birth: number;
  at: Vec3;
  dir: Vec3;
  /** 4 and 5 run back along the emit direction. */
  reverse: boolean;
  seed: number;
}
export const WAKE_LIFT: number;
```

`Emission` becomes `NanoEmission | FlameEmission | TracerEmission | SmokeEmission | VtolEmission | WakeEmission`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lego/effects.test.ts` (extend the import from `./effects` with `BITMAP_HEATCLOUD`, `BITMAP_WAKE`, `type SmokeEmission`, `type VtolEmission`, `type WakeEmission`, `type Vec3` and `WAKE_LIFT`):

```ts
/** `CSmokeProjectile::Update` replayed step by step in 32-bit floats, as the
 *  engine runs it, with no wind (`SmokeProjectile.cpp:85-98`). Null once the
 *  particle has been deleted. */
function replaySmoke(updates: number): { size: number; age: number } | null {
  const ageSpeed = Math.fround(1 / 60);
  let age = 0;
  let size = 0;
  for (let i = 0; i < updates; i++) {
    age = Math.fround(age + ageSpeed);
    size = Math.fround(size + 0.5);
    if (size < 4) size = Math.fround(size + (4 - size) * 0.2);
    age = Math.min(age, 1);
    if (age >= 1) return null;
  }
  return { size, age };
}

function smoke(overrides: Partial<SmokeEmission> = {}): SmokeEmission {
  return {
    kind: "smoke",
    birth: 0,
    at: [0, 0, 0],
    color: 0.5,
    seed: 7,
    ...overrides,
  };
}

describe("sfx smoke", () => {
  it("grows and dies as a direct replay of CSmokeProjectile::Update does", () => {
    for (let k = 0; k < 70; k++) {
      const replay = replaySmoke(k + 1);
      const { sprites } = particlesAt([smoke()], k);
      if (replay === null) {
        expect(sprites.count).toBe(0);
        continue;
      }
      expect(sprites.count).toBe(1);
      expect(sprites.halfSizes[0]).toBeCloseTo(replay.size, 4);
    }
  });

  it("fades as CSmokeProjectile::Draw does, black smoke a little lighter than white", () => {
    const replay = replaySmoke(1);
    if (!replay) throw new Error("smoke died on its first update");
    const alpha = Math.trunc((1 - replay.age) * 255);
    const white = particlesAt([smoke()], 0).sprites.colors;
    expect(white[0]).toBeCloseTo(Math.trunc(0.5 * alpha) / 255, 6);
    expect(white[3]).toBeCloseTo(alpha / 255, 6);
    const black = particlesAt([smoke({ color: 0.6 })], 0).sprites.colors;
    expect(black[0]).toBeCloseTo(Math.trunc(0.6 * alpha) / 255, 6);
  });

  it("rises 1.1 elmos a frame, give or take half an elmo in each direction", () => {
    const { sprites } = particlesAt([smoke()], 9);
    expect(sprites.centers[1]).toBeGreaterThanOrEqual(10 * 0.6 - 1e-4);
    expect(sprites.centers[1]).toBeLessThanOrEqual(10 * 1.6 + 1e-4);
    expect(Math.abs(sprites.centers[0])).toBeLessThanOrEqual(5 + 1e-4);
  });

  it("draws nothing before its birth frame", () => {
    expect(particlesAt([smoke({ birth: 5 })], 4).sprites.count).toBe(0);
  });

  it("picks one of the game's smoke bitmaps by its seed", () => {
    const picked = new Set<number>();
    for (let seed = 0; seed < 50; seed++) {
      picked.add(particlesAt([smoke({ seed })], 0, 4).sprites.bitmaps[0]);
    }
    for (const bitmap of picked) {
      expect(bitmap).toBeGreaterThanOrEqual(BITMAP_SMOKE);
      expect(bitmap).toBeLessThan(BITMAP_SMOKE + 4);
    }
    expect(picked.size).toBeGreaterThan(1);
  });
});

function vtol(dir: Vec3, overrides: Partial<VtolEmission> = {}): VtolEmission {
  return { kind: "vtol", birth: 0, at: [0, 0, 0], dir, seed: 3, ...overrides };
}

describe("sfx VTOL", () => {
  it("moves at half the emit direction a frame, always downward", () => {
    const sideways = particlesAt([vtol([0.6, 0.8, 0])], 0).sprites.centers;
    expect(sideways[0]).toBeCloseTo(0.3, 6);
    expect(sideways[1]).toBeCloseTo(-0.4, 6);
    expect(sideways[2]).toBeCloseTo(0, 6);
    const down = particlesAt([vtol([0, -1, 0])], 0).sprites.centers;
    expect(down[1]).toBeCloseTo(-0.5, 6);
  });

  it("starts at size 3 and lives as many frames as its temperature", () => {
    for (let seed = 0; seed < 30; seed++) {
      const first = particlesAt([vtol([0, 0, 1], { seed })], 0).sprites;
      expect(first.halfSizes[0]).toBeGreaterThanOrEqual(3.2 - 1e-6);
      expect(first.halfSizes[0]).toBeLessThanOrEqual(3.5 + 1e-6);
      expect(
        particlesAt([vtol([0, 0, 1], { seed })], 8).sprites.count,
      ).toBe(1);
      expect(
        particlesAt([vtol([0, 0, 1], { seed })], 14).sprites.count,
      ).toBe(0);
    }
  });

  it("glows by its heat with the heat cloud bitmap and almost no alpha", () => {
    const { sprites } = particlesAt([vtol([0, 0, 1])], 0);
    expect(sprites.bitmaps[0]).toBe(BITMAP_HEATCLOUD);
    expect(sprites.colors[3]).toBeCloseTo(1 / 255, 6);
    expect(sprites.colors[0]).toBeGreaterThanOrEqual(229 / 255 - 1e-6);
    expect(sprites.colors[0]).toBeLessThanOrEqual(238 / 255 + 1e-6);
  });
});

function wake(
  dir: Vec3,
  overrides: Partial<WakeEmission> = {},
): WakeEmission {
  return {
    kind: "wake",
    birth: 0,
    at: [0, 20, 0],
    dir,
    reverse: false,
    seed: 11,
    ...overrides,
  };
}

describe("sfx wake", () => {
  it("lies flat on the ground, whatever height it was emitted at", () => {
    const { sprites } = particlesAt([wake([1, 0, 0])], 0);
    expect(sprites.count).toBe(1);
    expect(sprites.centers[1]).toBe(WAKE_LIFT);
    expect(sprites.bitmaps[0]).toBe(BITMAP_WAKE);
    const axis = Array.from(sprites.axes.slice(0, 3));
    const side = Array.from(sprites.sides.slice(0, 3));
    expect(axis[1]).toBe(0);
    expect(side[1]).toBe(0);
    expect(Math.hypot(...axis)).toBeCloseTo(1, 6);
    expect(Math.hypot(...side)).toBeCloseTo(1, 6);
    expect(axis[0] * side[0] + axis[2] * side[2]).toBeCloseTo(0, 6);
    expect(sprites.halfLengths[0]).toBe(sprites.halfSizes[0]);
  });

  it("starts 6 to 10 elmos across and grows 0.15 to 0.45 a frame", () => {
    const { halfSizes } = particlesAt([wake([1, 0, 0])], 0).sprites;
    expect(halfSizes[0]).toBeGreaterThanOrEqual(6.15 - 1e-6);
    expect(halfSizes[0]).toBeLessThanOrEqual(10.45 + 1e-6);
  });

  it("fades up over four frames, then out, with the same value in every channel", () => {
    const alphas = Array.from({ length: 8 }, (_, k) => {
      const { colors } = particlesAt([wake([1, 0, 0])], k).sprites;
      expect(colors[0]).toBe(colors[3]);
      return colors[3];
    });
    for (let k = 1; k < 4; k++) expect(alphas[k]).toBeGreaterThan(alphas[k - 1]);
    for (let k = 4; k < 8; k++) expect(alphas[k]).toBeLessThan(alphas[k - 1]);
  });

  it("lasts until its alpha runs out at 0.004 a frame", () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(particlesAt([wake([1, 0, 0], { seed })], 70).sprites.count).toBe(1);
      expect(particlesAt([wake([1, 0, 0], { seed })], 130).sprites.count).toBe(0);
    }
  });

  it("drifts 0.4 elmos a frame along the emit direction, or back along it in reverse", () => {
    const dir: Vec3 = [0.6, 0.8, 0];
    const ahead = particlesAt([wake(dir)], 49).sprites.centers[0];
    const behind = particlesAt([wake(dir, { reverse: true })], 49).sprites
      .centers[0];
    expect(Math.abs(ahead - 50 * 0.4 * 0.6)).toBeLessThanOrEqual(2 + 1e-4);
    expect(Math.abs(behind + 50 * 0.4 * 0.6)).toBeLessThanOrEqual(2 + 1e-4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/effects.test.ts`
Expected: FAIL to compile or run, the new types and `WAKE_LIFT` are not exported.

- [ ] **Step 3: Implement**

In `src/lego/effects.ts`:

1. Add a paragraph to the header comment:

```ts
 * The engine's built-in sfx are drawn as its own particle classes draw them:
 * smoke as `CSmokeProjectile`, a VTOL jet as `CHeatCloudProjectile` and a wake
 * as `CWakeProjectile`. A CEG, whose real look the game defines, is a neutral
 * puff instead.
```

2. After `TracerEmission`, add the three interfaces exactly as in "Interfaces" above, and change the union to:

```ts
export type Emission =
  | NanoEmission
  | FlameEmission
  | TracerEmission
  | SmokeEmission
  | VtolEmission
  | WakeEmission;
```

3. Before `particlesAt`, add:

```ts
/** A sprite that turns to face the camera. */
function pushBillboard(
  out: SpriteArrays,
  center: Vec3,
  halfSize: number,
  color: [number, number, number, number],
  bitmap: number,
): void {
  out.centers.push(...center);
  out.halfSizes.push(halfSize);
  out.colors.push(...color);
  out.bitmaps.push(bitmap);
  out.axes.push(0, 0, 0);
  out.sides.push(0, 0, 0);
  out.halfLengths.push(0);
  out.uvRanges.push(0, 1);
}

/** `CSmokeProjectile`'s arguments for sfx 257 and 258: 60 frames, start size
 *  4, growing 0.5 a frame (`UnitScript.cpp:693-698`). */
const SMOKE_TTL = 60;
const SMOKE_START_SIZE = 4;
const SMOKE_SIZE_EXPANSION = 0.5;

/** Smoke on one frame, following `CSmokeProjectile::Update` and `Draw`
 *  (`SmokeProjectile.cpp:46-125`). Its size catches up towards its start size
 *  in a way with no simple closed form, so it is replayed from birth in
 *  32-bit floats, as the engine runs it. The replay stops when the particle
 *  dies, so it never runs more than about 60 steps. There is no wind in the
 *  preview, so the wind term is left out. */
function smokeSprites(
  emission: SmokeEmission,
  frame: number,
  smokeCount: number,
  out: SpriteArrays,
): void {
  const k = frame - emission.birth;
  if (k < 0) return;
  const updates = k + 1;
  const ageSpeed = Math.fround(1 / SMOKE_TTL);
  let age = 0;
  let size = 0;
  for (let i = 0; i < updates; i++) {
    age = Math.fround(age + ageSpeed);
    size = Math.fround(size + SMOKE_SIZE_EXPANSION);
    if (size < SMOKE_START_SIZE) {
      size = Math.fround(size + (SMOKE_START_SIZE - size) * 0.2);
    }
    age = Math.min(age, 1);
    if (age >= 1) return;
  }

  // speed = guRNG.NextVector() * 0.5 + UpVector * 1.1 (UnitScript.cpp:694).
  const wobble = ballPoint(emission.seed, 0);
  const center: Vec3 = [
    emission.at[0] + wobble[0] * 0.5 * updates,
    emission.at[1] + (wobble[1] * 0.5 + 1.1) * updates,
    emission.at[2] + wobble[2] * 0.5 * updates,
  ];
  const alpha = Math.trunc((1 - age) * 255);
  const shade = Math.trunc(emission.color * alpha) / 255;
  const texture = Math.min(
    smokeCount - 1,
    Math.floor(unitFloat(emission.seed, 3) * smokeCount),
  );
  pushBillboard(
    out,
    center,
    size,
    [shade, shade, shade, alpha / 255],
    BITMAP_SMOKE + texture,
  );
}

/** A VTOL jet's heat cloud on one frame. The arguments come from
 *  `UnitScript.cpp:700-717`: a temperature of 10 to 15, a size argument of 3
 *  to 5, and `size` set to 3 after construction. It moves at
 *  `GetObjectSpaceVec(0.5 * dir.x, -0.5 * |dir.y|, 0.5 * dir.z)`, the
 *  engine's formula with the unit's own speed at 0, since the preview unit
 *  does not move. `CHeatCloudProjectile` loses one heat a frame and dies at
 *  none, grows by `size / temperature` a frame, and draws its heat as
 *  brightness with an alpha of 1 (`HeatCloudProjectile.cpp:48-139`). */
function vtolSprites(
  emission: VtolEmission,
  frame: number,
  out: SpriteArrays,
): void {
  const k = frame - emission.birth;
  if (k < 0) return;
  const updates = k + 1;
  const temperature = 10 + unitFloat(emission.seed, 0) * 5;
  const heat = temperature - updates;
  if (heat <= 0) return;
  const growth = (3 + unitFloat(emission.seed, 1) * 2) / temperature;
  const speed: Vec3 = [
    0.5 * emission.dir[0],
    -0.5 * Math.abs(emission.dir[1]),
    0.5 * emission.dir[2],
  ];
  const glow = Math.trunc((heat / temperature) * 255) / 255;
  pushBillboard(
    out,
    [
      emission.at[0] + speed[0] * updates,
      emission.at[1] + speed[1] * updates,
      emission.at[2] + speed[2] * updates,
    ],
    3 + growth * updates,
    [glow, glow, glow, 1 / 255],
    BITMAP_HEATCLOUD,
  );
}

/** How far above the preview's ground a wake is drawn. The engine puts a
 *  wake at sea level (`WakeProjectile.cpp:48`), and the preview's ground
 *  counts as sea level, so a wake drawn at exactly 0 would flicker against
 *  the ground. Set by eye, to be tuned with the user on screen. */
export const WAKE_LIFT = 0.5;

/** `CWakeProjectile`'s ship values, from `UnitScript.cpp:638-640`. Hover
 *  craft use other values (`:645-649`) that depend on a move def the editor
 *  does not have. */
const WAKE_ALPHA_DECAY = 0.004;
const WAKE_FADEUP_TIME = 4;

/** A wake on one frame, following `CWakeProjectile` (`WakeProjectile.cpp:30-109`)
 *  with the arguments from `UnitScript.cpp:653-676`. It fades up over its
 *  first four updates, then out at 0.004 a frame, and is deleted once its
 *  alpha goes below 0. It lies flat and turns slowly. */
function wakeSprites(
  emission: WakeEmission,
  frame: number,
  out: SpriteArrays,
): void {
  const k = frame - emission.birth;
  if (k < 0) return;
  const updates = k + 1;
  const alphaStart = 0.3 + unitFloat(emission.seed, 5) * 0.2;
  const alphaAdd = alphaStart / WAKE_FADEUP_TIME;
  const alpha =
    Math.min(updates, WAKE_FADEUP_TIME) * alphaAdd -
    updates * WAKE_ALPHA_DECAY;
  if (updates > WAKE_FADEUP_TIME && alpha < 0) return;

  const wobble = ballPoint(emission.seed, 0);
  const pace = emission.reverse ? -0.4 : 0.4;
  const size =
    6 +
    unitFloat(emission.seed, 3) * 4 +
    (0.15 + unitFloat(emission.seed, 4) * 0.3) * updates;
  const rotation =
    unitFloat(emission.seed, 6) * Math.PI * 2 +
    (unitFloat(emission.seed, 7) - 0.5) * Math.PI * 2 * 0.01 * updates;
  const axis: Vec3 = [Math.cos(rotation), 0, Math.sin(rotation)];
  // dir1.cross(UpVector), WakeProjectile.cpp:99.
  const side: Vec3 = [-axis[2], 0, axis[0]];
  const shade = Math.trunc(255 * Math.max(alpha, 0)) / 255;

  out.centers.push(
    emission.at[0] + wobble[0] * 2 + emission.dir[0] * pace * updates,
    WAKE_LIFT,
    emission.at[2] + wobble[2] * 2 + emission.dir[2] * pace * updates,
  );
  out.halfSizes.push(size);
  out.colors.push(shade, shade, shade, shade);
  out.bitmaps.push(BITMAP_WAKE);
  out.axes.push(...axis);
  out.sides.push(...side);
  out.halfLengths.push(size);
  out.uvRanges.push(0, 1);
}
```

4. In `particlesAt`, after the `tracer` branch, add:

```ts
    if (emission.kind === "smoke") {
      smokeSprites(emission, frame, smokeCount, sprites);
      continue;
    }
    if (emission.kind === "vtol") {
      vtolSprites(emission, frame, sprites);
      continue;
    }
    if (emission.kind === "wake") {
      wakeSprites(emission, frame, sprites);
      continue;
    }
```

5. Import `BITMAP_HEATCLOUD` and `BITMAP_WAKE` are in the same file, so no import change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/lego/effects.test.ts && bun run typecheck && bunx biome ci src/lego`
Expected: PASS, no type errors, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/lego/effects.ts src/lego/effects.test.ts
git commit -m "Draw sfx smoke, VTOL heat clouds and wakes as the engine does"
```

---

### Task 5: CEG puff, detonation burst, and reading an sfx number

**Files:**
- Modify: `src/lego/effects.ts`
- Test: `src/lego/effects.test.ts`

**Interfaces:**
- Consumes: `BITMAP_EXPLO` (Task 2), `pushBillboard`, `SmokeEmission`, `VtolEmission`, `WakeEmission` (Task 4), `TracerEmission` (PR B).
- Produces, exported from `src/lego/effects.ts`:

```ts
export interface PuffEmission {
  kind: "puff" | "burst";
  birth: number;
  at: Vec3;
  dir: Vec3;
  seed: number;
}
export const PUFF_LIFE: number;
export const BURST_SCALE: number;
export const SFX_TRACER_RANGE: number;
/** Null for a bubble and for a number the engine draws nothing for. */
export function sfxEmission(
  sfx: number,
  birth: number,
  at: Vec3,
  dir: Vec3,
  seed: number,
): Emission | null;
```

`Emission` gains `| PuffEmission`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lego/effects.test.ts` (extend the import with `BITMAP_EXPLO`, `BURST_SCALE`, `type PuffEmission`, `PUFF_LIFE`, `SFX_TRACER_RANGE` and `sfxEmission`):

```ts
function puff(overrides: Partial<PuffEmission> = {}): PuffEmission {
  return {
    kind: "puff",
    birth: 0,
    at: [0, 0, 0],
    dir: [0, 1, 0],
    seed: 5,
    ...overrides,
  };
}

describe("the CEG puff and the detonation burst", () => {
  it("drifts along the emit direction, grows, and fades, with the explo bitmap", () => {
    const early = particlesAt([puff()], 0).sprites;
    const later = particlesAt([puff()], 5).sprites;
    expect(early.bitmaps[0]).toBe(BITMAP_EXPLO);
    expect(later.centers[1]).toBeGreaterThan(early.centers[1]);
    expect(later.centers[0]).toBe(0);
    expect(later.halfSizes[0]).toBeGreaterThan(early.halfSizes[0]);
    expect(later.colors[0]).toBeLessThan(early.colors[0]);
  });

  it("is gone once it has lived PUFF_LIFE updates", () => {
    expect(particlesAt([puff()], PUFF_LIFE - 2).sprites.count).toBe(1);
    expect(particlesAt([puff()], PUFF_LIFE - 1).sprites.count).toBe(0);
  });

  it("draws a burst as the same puff, BURST_SCALE times the size", () => {
    const small = particlesAt([puff()], 3).sprites.halfSizes[0];
    const big = particlesAt([puff({ kind: "burst" })], 3).sprites.halfSizes[0];
    expect(big).toBeCloseTo(small * BURST_SCALE, 6);
  });
});

describe("sfxEmission", () => {
  const at: Vec3 = [1, 2, 3];
  const dir: Vec3 = [0, 0, 1];
  const kindOf = (sfx: number) => sfxEmission(sfx, 4, at, dir, 9)?.kind ?? null;

  it("reads the built-in numbers", () => {
    expect(kindOf(0)).toBe("vtol");
    for (const sfx of [2, 3, 4, 5]) expect(kindOf(sfx)).toBe("wake");
    expect(sfxEmission(2, 4, at, dir, 9)).toMatchObject({ reverse: false });
    expect(sfxEmission(3, 4, at, dir, 9)).toMatchObject({ reverse: false });
    expect(sfxEmission(4, 4, at, dir, 9)).toMatchObject({ reverse: true });
    expect(sfxEmission(5, 4, at, dir, 9)).toMatchObject({ reverse: true });
    expect(sfxEmission(257, 4, at, dir, 9)).toMatchObject({
      kind: "smoke",
      color: 0.5,
    });
    expect(sfxEmission(258, 4, at, dir, 9)).toMatchObject({
      kind: "smoke",
      color: 0.6,
    });
  });

  it("draws nothing for a bubble or a number the engine does not know", () => {
    for (const sfx of [259, 1, 6, 256, 260, 1023]) {
      expect(kindOf(sfx)).toBeNull();
    }
  });

  it("reads the range bits", () => {
    expect(kindOf(1024 + 3)).toBe("puff");
    expect(kindOf(16384 + 2)).toBe("puff");
    expect(kindOf(4096 + 1)).toBe("burst");
    expect(sfxEmission(2048 + 1, 4, at, dir, 9)).toEqual({
      kind: "tracer",
      birth: 4,
      at,
      to: [1, 2, 3 + SFX_TRACER_RANGE],
      seed: 9,
      weapon: 2,
    });
  });

  it("tests the range bits in the engine's order, after the exact numbers", () => {
    expect(kindOf(1024 + 257)).toBe("puff");
    expect(kindOf(16384 + 2048)).toBe("puff");
    expect(kindOf(1024 + 2048)).toBe("puff");
    expect(kindOf(2048 + 4096)).toBe("tracer");
  });

  it("keeps the emission's birth, place and direction", () => {
    expect(sfxEmission(1024, 4, at, dir, 9)).toEqual({
      kind: "puff",
      birth: 4,
      at,
      dir,
      seed: 9,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/effects.test.ts`
Expected: FAIL, `sfxEmission` and the puff constants are not exported.

- [ ] **Step 3: Implement**

In `src/lego/effects.ts`:

1. After `WakeEmission`, add `PuffEmission` as in "Interfaces", with doc comments: `kind` "A CEG's stand-in puff, or a weapon detonation's larger burst.", `dir` "The emit direction, world space, unit length or zero."
2. Add `| PuffEmission` to the `Emission` union.
3. Before `particlesAt`, add:

```ts
/**
 * A CEG's stand-in puff. The game defines the real effect, and the preview
 * cannot read it without the unit def, so every number here is set by eye,
 * to be tuned with the user on screen: how many updates it lives, its half
 * size at birth, how much it grows an update and how far it drifts along the
 * emit direction an update. A detonation's burst is the same puff,
 * `BURST_SCALE` times the size.
 */
export const PUFF_LIFE = 20;
const PUFF_START_SIZE = 4;
const PUFF_GROWTH = 0.5;
const PUFF_DRIFT = 0.5;
export const BURST_SCALE = 3;

/** A puff or burst on one frame: brightness fading with age and an alpha of
 *  1, as the engine's heat cloud draws, with the `explo` bitmap. */
function puffSprites(
  emission: PuffEmission,
  frame: number,
  out: SpriteArrays,
): void {
  const k = frame - emission.birth;
  if (k < 0) return;
  const updates = k + 1;
  if (updates >= PUFF_LIFE) return;
  const scale = emission.kind === "burst" ? BURST_SCALE : 1;
  const glow = 1 - updates / PUFF_LIFE;
  pushBillboard(
    out,
    [
      emission.at[0] + emission.dir[0] * PUFF_DRIFT * updates,
      emission.at[1] + emission.dir[1] * PUFF_DRIFT * updates,
      emission.at[2] + emission.dir[2] * PUFF_DRIFT * updates,
    ],
    (PUFF_START_SIZE + PUFF_GROWTH * updates) * scale,
    [glow, glow, glow, 1 / 255],
    BITMAP_EXPLO,
  );
}

/** How far an `sfx 2048 + n` tracer runs along the emit direction. The
 *  engine aims the weapon one elmo ahead of the emit point
 *  (`UnitScript.cpp:768`), which would draw nothing to see, and the weapon's
 *  real range needs its unit def. Set by eye, to be tuned with the user on
 *  screen. */
export const SFX_TRACER_RANGE = 200;

/** `EmitSfx`'s numbers (`rts/Sim/Units/Scripts/CobDefines.h:9-20`). */
const SFX_VTOL = 0;
const SFX_WAKE = 2;
const SFX_WAKE_2 = 3;
const SFX_REVERSE_WAKE = 4;
const SFX_REVERSE_WAKE_2 = 5;
const SFX_WHITE_SMOKE = 257;
const SFX_BLACK_SMOKE = 258;
const SFX_CEG = 1024;
const SFX_FIRE_WEAPON = 2048;
const SFX_DETONATE_WEAPON = 4096;
const SFX_GLOBAL = 16384;

/**
 * What an `emit-sfx` number draws, read in the engine's order: the exact
 * built-in numbers first, then the range bits, global CEG, unit CEG, fire
 * weapon, then detonate weapon (`UnitScript.cpp:651-790`). A bubble (259)
 * sits under the water line and so under the preview's ground, and draws
 * nothing, as does a number the engine does not know.
 */
export function sfxEmission(
  sfx: number,
  birth: number,
  at: Vec3,
  dir: Vec3,
  seed: number,
): Emission | null {
  switch (sfx) {
    case SFX_REVERSE_WAKE:
    case SFX_REVERSE_WAKE_2:
      return { kind: "wake", birth, at, dir, reverse: true, seed };
    case SFX_WAKE:
    case SFX_WAKE_2:
      return { kind: "wake", birth, at, dir, reverse: false, seed };
    case SFX_WHITE_SMOKE:
      return { kind: "smoke", birth, at, color: 0.5, seed };
    case SFX_BLACK_SMOKE:
      return { kind: "smoke", birth, at, color: 0.6, seed };
    case SFX_VTOL:
      return { kind: "vtol", birth, at, dir, seed };
  }
  if ((sfx & (SFX_GLOBAL | SFX_CEG)) !== 0) {
    return { kind: "puff", birth, at, dir, seed };
  }
  if ((sfx & SFX_FIRE_WEAPON) !== 0) {
    return {
      kind: "tracer",
      birth,
      at,
      to: [
        at[0] + dir[0] * SFX_TRACER_RANGE,
        at[1] + dir[1] * SFX_TRACER_RANGE,
        at[2] + dir[2] * SFX_TRACER_RANGE,
      ],
      seed,
      // A unit definition counts its weapons from one.
      weapon: sfx - SFX_FIRE_WEAPON + 1,
    };
  }
  if ((sfx & SFX_DETONATE_WEAPON) !== 0) {
    return { kind: "burst", birth, at, dir, seed };
  }
  return null;
}
```

4. In `particlesAt`, after the `wake` branch, add:

```ts
    if (emission.kind === "puff" || emission.kind === "burst") {
      puffSprites(emission, frame, sprites);
      continue;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/lego/effects.test.ts && bun run typecheck && bunx biome ci src/lego`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lego/effects.ts src/lego/effects.test.ts
git commit -m "Read an sfx number the engine's way, and draw CEGs and detonations as a puff"
```

---

### Task 6: Resolve sfx outputs in playback

**Files:**
- Modify: `src/lego/pages/components/effectsPlayback.ts` (header comment :1-11, imports :16-23, a `DIR` vector beside `AT` at :38, the `timeline.events.forEach` in `resolve` at :189-261)
- Test: `src/lego/pages/components/ModelViewport.dom.test.tsx` (the `placeEffects` describe block, from :721)

**Interfaces:**
- Consumes: `sfxEmission` (Task 5), `emitPoint`, `PieceVertices`, `groupOfPiece`.
- Produces: nothing new. `placeEffects` now draws sfx.

- [ ] **Step 1: Write the failing tests**

Add to the `placeEffects` describe block in `src/lego/pages/components/ModelViewport.dom.test.tsx`, after `draws no tracer for a shot from no piece`:

```ts
    /** The arm's emit vertex is ten elmos above its origin, and the arm's
     *  rest position in `standInScene` is y = 4. */
    const upTheArm: PieceVertices = (piece) =>
      piece === "arm"
        ? [
            [0, 10, 0],
            [1, 10, 0],
          ]
        : [];

    it("draws sfx smoke at the emit vertex, on the pose of the frame before", () => {
      const state = sprayScene();
      const timeline = run(40, (frame) => frame * 100, [
        { frame: 5, kind: "sfx", piece: "arm", sfx: 257 },
      ]);
      placeEffects(
        state,
        doc,
        { ...aiming, track: null },
        true,
        timeline,
        5,
        upTheArm,
      );
      expect(sprites(state).instanceCount).toBe(1);
      const center = sprites(state).getAttribute("center").array;
      // Frame 4's pose puts the arm at x = 400. One update of smoke moves it
      // at most half an elmo sideways and 1.1 plus or minus half an elmo up.
      expectNear(center[0], 400, 0.51);
      expectNear(center[1], 14 + 1.1, 0.51);
    });

    it("fires sfx 2048 + n as a tracer along the emit direction, with no stand-in", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [
        { frame: 5, kind: "sfx", piece: "arm", sfx: 2048 },
      ]);
      placeEffects(
        state,
        doc,
        { ...aiming, track: null },
        true,
        timeline,
        6,
        upTheArm,
      );
      expect(sprites(state).instanceCount).toBe(6);
      const axis = sprites(state).getAttribute("axis").array;
      const bodyOuter = 2;
      expectNear(axis[bodyOuter * 3], 1, 1e-6);
      expectNear(axis[bodyOuter * 3 + 1], 0, 1e-6);
      expectNear(axis[bodyOuter * 3 + 2], 0, 1e-6);
    });

    it("draws nothing for a bubble or an sfx from a piece the model does not have", () => {
      const state = sprayScene();
      const timeline = run(40, () => 0, [
        { frame: 5, kind: "sfx", piece: "arm", sfx: 259 },
        { frame: 5, kind: "sfx", piece: "nowhere", sfx: 257 },
      ]);
      placeEffects(state, doc, aiming, true, timeline, 5, upTheArm);
      expect(sprites(state).instanceCount).toBe(0);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/pages/components/ModelViewport.dom.test.tsx -t "sfx"`
Expected: the smoke and tracer tests FAIL with an instance count of 0. The bubble test passes already.

- [ ] **Step 3: Implement**

In `src/lego/pages/components/effectsPlayback.ts`:

1. Change the header's first sentence to: "Draw what a running script emitted, on one frame: nano spray, a muzzle flame for each flare, a tracer for each shot, and the engine's built-in sfx."
2. Add `sfxEmission,` to the import from `../../effects`, in alphabetical order after `particlesAt`.
3. After `const AT = new THREE.Vector3();` add `const DIR = new THREE.Vector3();`.
4. In `resolve`, inside `timeline.events.forEach`, after the `shot` branch's closing brace, add:

```ts
    if (event.kind === "sfx") {
      const group = groupOfPiece(state, project, event.piece);
      if (!group) return;
      poseBefore(event.frame);
      group.updateWorldMatrix(true, false);
      // The engine emits from the piece's emit vertex along its emit
      // direction, normalised (`UnitScript.cpp:597-617`). The preview unit
      // never moves or turns, so the piece's world matrix is the engine's
      // piece to world transform.
      const { pos, dir } = emitPoint(vertices(event.piece));
      AT.set(...pos).applyMatrix4(group.matrixWorld);
      DIR.set(...dir).transformDirection(group.matrixWorld);
      const emission = sfxEmission(
        event.sfx,
        event.frame,
        [AT.x, AT.y, AT.z],
        [DIR.x, DIR.y, DIR.z],
        seed,
      );
      if (emission) emissions.push(emission);
    }
```

`transformDirection` normalises, and leaves a zero direction at zero, as the engine's `SafeNormalize` does.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/lego/pages/components/ModelViewport.dom.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lego/pages/components/effectsPlayback.ts src/lego/pages/components/ModelViewport.dom.test.tsx
git commit -m "Draw a script's emit-sfx in the model preview"
```

---

### Task 7: Full check suite and on-screen check

Done by the lead, not a subagent, because it needs the Tauri MCP.

- [ ] **Step 1:** Run all seven CI commands: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`. Check `df -h .` first.
- [ ] **Step 2:** Start an own instance on port 1433 with the MCP socket at `/tmp/tauri-mcp-nano.sock` (local edits to `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json` and `vite.config.ts`), seed a portable profile, and drive it through a second MCP server over stdio.
- [ ] **Step 3:** Screenshot a unit whose script emits smoke, a ship's wake under `moving`, and a CEG puff, and scrub back and forth over one frame to show the same picture each time.
- [ ] **Step 4:** Revert the port and socket edits, remove `profile.json`, and stop the instance and its vite.
