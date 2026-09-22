# Stand-in unit for the model editor: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a crude, inert stand-in unit in the model editor's viewport that the edited model can aim at, build and carry, so an animation plays against something instead of nothing.

**Architecture:** A scenario gains an optional `standIn` track of keyframes in unit-local space, measured in multiples of a radius derived from the edited unit's own size. A pure resolver turns that track plus the model into concrete radian arguments for `AimWeapon1` and `StartBuilding`, reproducing the engine's own formulas. The viewport builds one three.js group and places it per frame alongside the baked pose. `ScriptTimeline` does not change.

**Tech Stack:** TypeScript, three.js, React, vitest. One Rust change in `crates/tauri-plugin-coilbox-anim/src/cobrun.rs` for the COB transport argument forms.

**Spec:** `docs/superpowers/specs/2026-09-22-model-editor-stand-in-unit-design.md`

## Corrections to the spec, from reading the engine

Three facts in the spec do not survive a check against `~/dev/RecoilEngine`. The plan below follows the engine, not the spec, on these three.

1. **`TransportPickup` is not part of air transport.** `MobileCAI.cpp:1424-1464` branches on `dynamic_cast<CHoverAirMoveType*>(owner->moveType)`. The air arm calls `BeginTransport(unit)` then `AttachUnit(unit, QueryTransport(unit))`. `TransportPickup` is the `else` arm, which is ground and ship transport, and the spec puts that out of scope. So `transport-load` drives `BeginTransport` only, and gets its piece from the `QueryTransport` probe.

2. **`StartUnload` has no caller in the engine.** `grep -rn StartUnload ~/dev/RecoilEngine/rts/` matches only the script interface files (`CobInstance.cpp:539`, `LuaUnitScript.cpp:1009`, the two name tables and the two headers). That is exactly the test the spec itself used to rule out `QueryLandingPad`. So `transport-unload` drives `TransportDrop` and `EndTransport` and not `StartUnload`.

3. **`StartBuilding`'s second argument is `p - pitch`, where `pitch = asin(frontdir · updir)`.** `Builder.cpp:942-955` has a term the spec omits. It is zero for a unit on flat ground, which the editor's unit always is, so the resolver computes `p` and records why the other term is absent.

Two more facts, confirmed as the spec states them:

- `Weapon.cpp:410-424` computes `heading = GetHeadingFromVectorF(wantedDir·rightdir, wantedDir·frontdir)` and `pitch = asin(wantedDir·updir)`, then calls `script->AimWeapon(weaponNum, ClampRadPi(-heading), pitch)`. With `rightdir = {-frontdir.z, 0, frontdir.x}` (`SolidObject.cpp:440`) and `frontdir` being `(0,0,1)` at heading zero (`SpringMath.inl:109-116`, `SpringMath.cpp:22-27`), `rightdir` is `(-1,0,0)`. So model `+x` is the unit's left, which is what `buildPlate.ts:296-304` already records from the headless run on issue #565. A target at `+x` gives `+π/2`. **Positive heading means the target is to the unit's left. Positive pitch means above.**
- Lua argument forms (`LuaUnitScript.cpp:139-141, 787-826`): `BeginTransport(unitID)`, `QueryTransport(unitID)`, `TransportDrop(unitID, x, y, z)`, `EndTransport()`. COB forms (`CobInstance.cpp:355-395`): `BeginTransport(height*65536)`, `QueryTransport(0, height*65536)`, `TransportDrop(unitID, PACKXZ(x,z))`, where `PACKXZ(x,z) = ((int)x << 16) + ((int)z & 0xffff)` (`CobInstance.h:10`).

## Global Constraints

- Angles in a scenario are radians. `cobrun.rs` already scales them by `RAD2TAANG` for the compiled runtime (`cobrun.rs:198-206, 413-418`). The Lua runtime takes them unchanged.
- Model axes: `+z` is the unit's front, `+y` is up, `+x` is the unit's left. `buildPlate.ts:296-304`.
- Sizes are in elmos with nothing rescaled: a shape sized in three.js world units here is that size in game. `referenceObject.ts:16-23`.
- The stand-in is a view aid. Never selected, hovered, seated against, baked or exported. Every mesh gets `raycast = () => {}`, as `referenceObject.ts:105` does.
- No new dependency. No collision volume, no pieces, no animation of its own, no particles, no game model, no landing pad, no ground or ship transport.
- UI copy calls it "Stand-in unit".
- Prefer picoframe components. The new toggle goes in `ViewControls` beside `ReferencePicker`, using the existing `ViewToggle`.
- Run the full seven-command CI suite before any PR. See `CLAUDE.md`.

## Deviation from the spec, stated

The spec says the visibility toggle is "placed with the existing environment and reference controls in `BuilderPage.tsx`, persisted through `src/lego/panels.ts` the way the other view settings are". Both halves are wrong about where the code is. The environment and reference controls are in `ModelViewport.tsx:1295-1338`, and none of the view settings is persisted: `ModelViewport.tsx:505-509` documents them as "View settings, held for as long as the viewport is open and no longer". This plan follows the code: a plain `useState` in `ModelViewport.tsx`, beside the other toggles, matching every neighbour. `panels.ts` is untouched.

---

## File structure

**New**

- `src/lego/standIn.ts` - the stand-in's radius, its geometry and material, and where it sits on a given frame. Knows nothing about scripts.
- `src/lego/standIn.test.ts`
- `src/lego/aimResolver.ts` - pure. Scenario plus model in, scenario with concrete radian arguments out.
- `src/lego/aimResolver.test.ts`
- `src/lego/pages/components/standInPlayback.ts` - places the scene's stand-in group for a frame, including riding an attach piece.

**Modified**

- `src/lego/scriptPlayback.ts` - the track types, `ScriptEvent.aimAtStandIn`, `Scenario.standIn`, and the five scenarios.
- `src/lego/scriptPlayback.test.ts`
- `src/lego/s3oBuild.ts` - `pieceWorldRest`.
- `src/lego/s3oBuild.test.ts`
- `src/lego/pages/components/sceneState.ts` - three fields for the stand-in.
- `src/lego/pages/components/useScriptFrameStepping.ts` - place the stand-in on every posed frame.
- `src/lego/pages/components/ModelViewport.tsx` - build, dispose, toggle.
- `src/lego/pages/components/ModelViewport.dom.test.tsx`
- `src/lego/pages/components/AnimationPanel.tsx` - probe, resolve, report the track up.
- `src/lego/pages/BuilderPage.tsx` - carry the track and the radius between panel and viewport.
- `crates/tauri-plugin-coilbox-anim/src/cobrun.rs` - the COB transport argument forms.
- `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`

---

### Task 1: The track types and key interpolation

**Files:**
- Modify: `src/lego/scriptPlayback.ts` (types only, beside `Scenario` at `:87-93`)
- Create: `src/lego/standIn.ts`
- Test: `src/lego/standIn.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, exported from `scriptPlayback.ts`: `StandInKey`, `StandInAttach`, `StandInTrack`.
- Produces, exported from `standIn.ts`:
  - `STAND_IN_MID_Y: number`
  - `standInRadius(bounds: UnitBounds): number`
  - `standInAt(track, frame, radius): StandInPose | null`, where `StandInPose` is `{ pos: [number, number, number], heading: number, fromAttachPiece: boolean }`
  - `attachedAt(track, frame): StandInAttach | null`

- [ ] **Step 1: Write the failing test**

Create `src/lego/standIn.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { StandInTrack } from "./scriptPlayback";
import { attachedAt, standInAt, standInRadius } from "./standIn";

/** Two keys, ten frames apart, moving two radii along x and one up. */
function track(overrides: Partial<StandInTrack> = {}): StandInTrack {
  return {
    keys: [
      { frame: 10, pos: [0, 0, 2] },
      { frame: 20, pos: [2, 1, 2] },
    ],
    ...overrides,
  };
}

describe("standInAt", () => {
  it("scales a key's radius multiples into elmos", () => {
    expect(standInAt(track(), 10, 8)?.pos).toEqual([0, 0, 16]);
  });

  it("interpolates between two keys", () => {
    expect(standInAt(track(), 15, 8)?.pos).toEqual([8, 4, 16]);
  });

  /** A frame before the first key holds the first key, rather than
   *  extrapolating backwards to somewhere the scenario never asked for. */
  it("holds the first key before the track starts", () => {
    expect(standInAt(track(), 0, 8)?.pos).toEqual([0, 0, 16]);
  });

  it("holds the last key after the track ends", () => {
    expect(standInAt(track(), 999, 8)?.pos).toEqual([16, 8, 16]);
  });

  it("has no position at all for a track with no keys", () => {
    expect(standInAt({ keys: [] }, 0, 8)).toBeNull();
  });

  /** Heading is optional on a key and interpolates like the position does. */
  it("interpolates heading, and is zero where no key sets one", () => {
    const turning: StandInTrack = {
      keys: [
        { frame: 0, pos: [0, 0, 0], heading: 0 },
        { frame: 10, pos: [0, 0, 0], heading: 1 },
      ],
    };
    expect(standInAt(turning, 5, 8)?.heading).toBeCloseTo(0.5);
    expect(standInAt(track(), 15, 8)?.heading).toBe(0);
  });

  /** A key measured from the attach piece says so, which is what a dropped
   *  passenger needs: it leaves the transport where the transport held it. */
  it("reports which origin a key is measured from", () => {
    const dropped = track({
      keys: [
        { frame: 0, pos: [0, 0, 0], fromAttachPiece: true },
        { frame: 10, pos: [0, -1, -1], fromAttachPiece: true },
      ],
    });
    expect(standInAt(dropped, 5, 8)?.fromAttachPiece).toBe(true);
    expect(standInAt(track(), 15, 8)?.fromAttachPiece).toBe(false);
  });
});

describe("attachedAt", () => {
  const riding: StandInTrack = {
    keys: [{ frame: 0, pos: [0, 0, 0] }],
    attach: {
      from: "QueryTransport",
      frame: 10,
      until: 20,
      follow: true,
    },
  };

  it("is nothing before the attach frame", () => {
    expect(attachedAt(riding, 9)).toBeNull();
  });

  it("is the attach from its own frame on", () => {
    expect(attachedAt(riding, 10)?.from).toBe("QueryTransport");
    expect(attachedAt(riding, 19)?.from).toBe("QueryTransport");
  });

  it("is nothing again once it detaches", () => {
    expect(attachedAt(riding, 20)).toBeNull();
  });

  it("never ends when nothing says it should", () => {
    const held: StandInTrack = {
      keys: [{ frame: 0, pos: [0, 0, 0] }],
      attach: {
        from: "QueryBuildInfo",
        frame: 0,
        until: null,
        follow: false,
      },
    };
    expect(attachedAt(held, 999)?.from).toBe("QueryBuildInfo");
  });

  it("is nothing for a track with no attach", () => {
    expect(attachedAt(track(), 5)).toBeNull();
  });
});

describe("standInRadius", () => {
  /** A third of the unit's larger horizontal extent, so it reads as another
   *  unit rather than a speck or a wall. */
  it("is a third of the wider horizontal extent", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 60, sizeY: 20, sizeZ: 30 }),
    ).toBe(20);
  });

  it("uses z when the unit is longer than it is wide", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 30, sizeY: 20, sizeZ: 60 }),
    ).toBe(20);
  });

  it("never disappears for a unit with almost nothing in it", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 0, sizeY: 0, sizeZ: 0 }),
    ).toBe(6);
  });

  it("never grows into a wall beside a very large unit", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 600, sizeY: 100, sizeZ: 600 }),
    ).toBe(40);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/lego/standIn.test.ts`
Expected: FAIL, "Failed to resolve import ./standIn".

- [ ] **Step 3: Add the track types to `scriptPlayback.ts`**

Insert directly above `export interface Scenario` at `src/lego/scriptPlayback.ts:87`:

```ts
/** Where the stand-in is on one frame, and which way it faces. */
export interface StandInKey {
  frame: number;
  /** Unit-local, in multiples of the stand-in's radius. A track written this
   *  way serves a scout and a factory alike, since the radius comes from the
   *  edited unit's own size rather than from the track. */
  pos: [number, number, number];
  /**
   * Measure `pos` from the attach piece's rest position rather than from the
   * unit's origin.
   *
   * What a dropped passenger needs: it leaves the transport from where the
   * transport was holding it, not from where the unit's origin happens to be.
   */
  fromAttachPiece?: boolean;
  /** Radians about the vertical axis, relative to the unit's facing. Zero
   *  where no key sets one. */
  heading?: number;
}

/** The piece the stand-in sits on, and for how long. */
export interface StandInAttach {
  /** The call-in the probe asks for that piece. */
  from: "QueryTransport" | "QueryBuildInfo";
  /** The first frame the stand-in sits on it. */
  frame: number;
  /** The frame it comes off again, or null to stay on to the end. */
  until: number | null;
  /**
   * Ride the piece as it animates, rather than sitting where the piece rests.
   *
   * A transport carries its passenger, so it follows. A factory spawns the
   * unit it builds at the piece's world position once and leaves it there
   * (`rts/Sim/Units/UnitTypes/Factory.cpp:95-101,178`), so it does not.
   */
  follow: boolean;
}

/** Where the stand-in goes over a scenario, as a preview aid layered over the
 *  timeline. The runtimes know nothing about it. */
export interface StandInTrack {
  keys: StandInKey[];
  attach?: StandInAttach | null;
}
```

Then add to `Scenario`, after `events`:

```ts
  /** The stand-in this scenario puts in the scene, if it puts one there at
   *  all. A scenario with no track shows no stand-in. */
  standIn?: StandInTrack;
```

- [ ] **Step 4: Write `src/lego/standIn.ts` with the interpolation only**

Geometry comes in Task 6. For now:

```ts
/**
 * A crude, inert second unit for the model editor to aim at, build and carry.
 *
 * A sibling of `referenceObject.ts` rather than a mode of it. The reference
 * figure is a real game unit and exists to judge scale against. This is a
 * shape with no game behind it, and exists so that an animation has something
 * to be about. An aim that is right and an aim that is wrong look the same
 * against an empty scene.
 *
 * It knows nothing about scripts. A scenario says where it goes, the viewport
 * puts it there, and `aimResolver.ts` works out what the unit should be told
 * about it.
 */

import type { StandInAttach, StandInKey, StandInTrack } from "./scriptPlayback";
import type { UnitBounds } from "./s3oBuild";

type Vec3 = [number, number, number];

/**
 * How big the stand-in is beside the unit being edited: a third of the unit's
 * wider horizontal extent.
 *
 * Judged by looking rather than derived. A fixed size is a speck beside a
 * factory and a wall beside a scout, and the point of the thing is that it
 * reads as another unit.
 */
const RADIUS_FRACTION = 1 / 3;
/** The smallest it goes, in elmos, so a unit with almost nothing built yet
 *  still has something visible to aim at. */
const MIN_RADIUS = 6;
/** The largest, so the biggest factory in a game gets a target rather than a
 *  second building. */
const MAX_RADIUS = 40;

/**
 * How high the stand-in's middle is above its base, in multiples of its
 * radius.
 *
 * A track's positions say where the stand-in stands, so `y: 0` sits it on the
 * ground exactly as the engine stands a unit on `y = 0`. What a weapon aims at
 * is the unit's middle, so this is what the resolver adds. Half the height the
 * shape in `buildStandIn` is built to.
 */
export const STAND_IN_MID_Y = 0.55;

/** How big the stand-in beside this unit should be, in elmos. */
export function standInRadius(bounds: UnitBounds): number {
  const across = Math.max(bounds.sizeX, bounds.sizeZ) * RADIUS_FRACTION;
  return Math.min(Math.max(across, MIN_RADIUS), MAX_RADIUS);
}

/** Where the stand-in is on one frame, in elmos, and which way it faces. */
export interface StandInPose {
  /** Unit-local, in elmos. Measured from the attach piece when
   *  `fromAttachPiece` says so, and from the unit's origin otherwise. */
  pos: Vec3;
  /** Radians about the vertical axis, relative to the unit's facing. */
  heading: number;
  fromAttachPiece: boolean;
}

/**
 * Where a track puts the stand-in on one frame.
 *
 * Keys interpolate linearly. A frame outside the track holds the nearest key
 * rather than extrapolating past it, because a scenario that stops asking for
 * something has stopped asking, and a stand-in sliding out of the scene at the
 * end of a preview would be a bug that looks like a feature.
 */
export function standInAt(
  track: StandInTrack,
  frame: number,
  radius: number,
): StandInPose | null {
  const { keys } = track;
  if (keys.length === 0) return null;

  const first = keys[0];
  if (frame <= first.frame) return posed(first, radius);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return posed(last, radius);

  for (let i = 1; i < keys.length; i++) {
    const to = keys[i];
    if (frame > to.frame) continue;
    const from = keys[i - 1];
    const span = to.frame - from.frame;
    // Two keys on the same frame: the later one wins, as the loop's own
    // ordering already implies, rather than dividing by nothing.
    const t = span === 0 ? 1 : (frame - from.frame) / span;
    return {
      pos: [
        mix(from.pos[0], to.pos[0], t) * radius,
        mix(from.pos[1], to.pos[1], t) * radius,
        mix(from.pos[2], to.pos[2], t) * radius,
      ],
      heading: mix(from.heading ?? 0, to.heading ?? 0, t),
      // The key being moved towards, since that is the one that says where the
      // motion ends up. Tracks never mix the two origins mid-move.
      fromAttachPiece: to.fromAttachPiece ?? false,
    };
  }
  return posed(last, radius);
}

function posed(key: StandInKey, radius: number): StandInPose {
  return {
    pos: [key.pos[0] * radius, key.pos[1] * radius, key.pos[2] * radius],
    heading: key.heading ?? 0,
    fromAttachPiece: key.fromAttachPiece ?? false,
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The attachment in force on a frame, or null when the stand-in is loose. */
export function attachedAt(
  track: StandInTrack,
  frame: number,
): StandInAttach | null {
  const attach = track.attach;
  if (!attach) return null;
  if (frame < attach.frame) return null;
  if (attach.until !== null && frame >= attach.until) return null;
  return attach;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test src/lego/standIn.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lego/standIn.ts src/lego/standIn.test.ts src/lego/scriptPlayback.ts
git commit -m "Give a scenario a stand-in track, and read it per frame"
```

---

### Task 2: A piece's rest position in unit space

The aim resolver needs to know where `AimFromWeapon1`'s piece sits. `pieceRest` gives parent-relative document offsets, and the viewport animates baked offsets, which differ whenever an ancestor carries rotation or scale. This gives the accumulated world translation off the bake, which is what an s3o stores and what the engine animates.

**Files:**
- Modify: `src/lego/s3oBuild.ts`
- Test: `src/lego/s3oBuild.test.ts`

**Interfaces:**
- Consumes: `bakedPieces` from `s3oBuild.ts:93`.
- Produces: `pieceWorldRest(project: LegoProject, pack: LoadedPack, raw: RawGeometry | null): Map<string, [number, number, number]>`, keyed by **piece name**.

- [ ] **Step 1: Write the failing test**

Append to `src/lego/s3oBuild.test.ts`. Use whatever `project`, `piece` and pack helpers that file already defines. Read the top of it first and follow its conventions rather than these names.

```ts
describe("pieceWorldRest", () => {
  /** A chain of three pieces, each a step out along x, so the third sits at
   *  three steps whatever the bake does to the geometry in between. */
  it("accumulates a piece's offsets up to the root", () => {
    const doc = project(
      { ...piece("a", "base"), position: [1, 0, 0] },
      { ...piece("b", "a"), position: [1, 0, 0] },
      { ...piece("c", "b"), position: [1, 0, 0] },
    );
    const rest = pieceWorldRest(doc, loaded, null);
    expect(rest.get("c")).toEqual([3, 0, 0]);
  });

  /**
   * A parent's rotation turns where its child sits, which is exactly what
   * summing the document's own offsets would miss. A quarter turn about y
   * sends a child that sits one step along x round to one step along -z.
   */
  it("carries a parent's rotation into where its child rests", () => {
    const doc = project(
      { ...piece("a", "base"), rotation: [0, Math.PI / 2, 0] },
      { ...piece("b", "a"), position: [1, 0, 0] },
    );
    const [x, y, z] = pieceWorldRest(doc, loaded, null).get("b") ?? [0, 0, 0];
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });

  it("has nothing for a piece the unit does not have", () => {
    expect(pieceWorldRest(project(), loaded, null).get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/lego/s3oBuild.test.ts -t pieceWorldRest`
Expected: FAIL, `pieceWorldRest is not a function`.

- [ ] **Step 3: Implement it**

Add to `src/lego/s3oBuild.ts`, directly after `bakedPieces`:

```ts
/**
 * Where each piece rests in the unit's own space, by piece name.
 *
 * Off the bake rather than off the document's offsets, because the two part
 * company the moment an ancestor carries a rotation or a scale, and the bake
 * is what an s3o stores and therefore what the engine animates. Anything
 * reasoning about where a piece actually is has to agree with the file.
 *
 * Keyed by name rather than by id because callers reaching for this have a
 * name: a script probe answers with one, and so does a timeline.
 */
export function pieceWorldRest(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): Map<string, [number, number, number]> {
  const { pieces } = bakedPieces(project, pack, raw);
  const world = new Map<string, [number, number, number]>();

  const walk = (pieceId: string, from: [number, number, number]) => {
    const baked = pieces.get(pieceId);
    if (!baked) return;
    const at: [number, number, number] = [
      from[0] + baked.offset[0],
      from[1] + baked.offset[1],
      from[2] + baked.offset[2],
    ];
    world.set(baked.name, at);
    for (const child of childrenOf(project, pieceId)) walk(child.id, at);
  };

  walk(project.rootPieceId, [0, 0, 0]);
  return world;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/lego/s3oBuild.test.ts -t pieceWorldRest`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lego/s3oBuild.ts src/lego/s3oBuild.test.ts
git commit -m "Read where a piece rests in the unit's own space"
```

---

### Task 3: The aim resolver

**Files:**
- Modify: `src/lego/scriptPlayback.ts` (the `aimAtStandIn` marker on `ScriptEvent`)
- Create: `src/lego/aimResolver.ts`
- Test: `src/lego/aimResolver.test.ts`

**Interfaces:**

- Consumes, from `standIn.ts`: `standInAt`, `STAND_IN_MID_Y`.
- Consumes, from `scriptPlayback.ts`: `Scenario`, `ScriptEvent`, `StandInTrack`.
- Produces:
  ```ts
  export interface AimContext {
    /** The stand-in's radius beside this unit, in elmos. */
    radius: number
    /** The unit's aim point, which is also its midPos: `aimPoint(project, bounds)`. */
    mid: [number, number, number]
    /** Where each piece rests in unit space, by name: `pieceWorldRest(...)`. */
    pieceRest: Map<string, [number, number, number]>
    /** The first piece a probe named for a call-in, or null when it named none. */
    probed: (callin: string) => string | null
  }
  export interface ResolvedScenario {
    events: ScriptEvent[]
    /** What could not be worked out, for the panel to show. */
    notes: string[]
  }
  export function resolveScenario(scenario: Scenario, ctx: AimContext): ResolvedScenario
  export function aimWeaponAngles(from: Vec3, to: Vec3): { heading: number, pitch: number }
  export function startBuildingAngles(mid: Vec3, to: Vec3): { heading: number, pitch: number }
  export function standInMid(track: StandInTrack, frame: number, radius: number): Vec3 | null
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lego/aimResolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  type AimContext,
  aimWeaponAngles,
  resolveScenario,
  startBuildingAngles,
} from "./aimResolver";
import type { Scenario } from "./scriptPlayback";

/**
 * The unit's own axes in the editor: `+z` front, `+y` up, `+x` its left. Pinned
 * by the headless engine run on issue #565 and recorded in `buildPlate.ts`.
 *
 * Everything below is checked against the engine's formula rather than against
 * a number somebody once read off a run, because a recorded output cannot tell
 * a sign error from a convention.
 */
const LEFT: [number, number, number] = [10, 0, 0];
const RIGHT: [number, number, number] = [-10, 0, 0];
const FRONT: [number, number, number] = [0, 0, 10];
const ORIGIN: [number, number, number] = [0, 0, 0];

describe("aimWeaponAngles", () => {
  /**
   * `rts/Sim/Weapons/Weapon.cpp:410-424`:
   *
   *   heading = GetHeadingFromVectorF(dir·rightdir, dir·frontdir)
   *   script->AimWeapon(n, ClampRadPi(-heading), asin(dir·updir))
   *
   * `rightdir` is `(-1,0,0)` for a unit at heading zero
   * (`rts/Sim/Objects/SolidObject.cpp:440`), so a target at `+x` gives
   * `dir·rightdir = -1`, a heading of `-PI/2`, and `+PI/2` after the negation.
   */
  it("is positive for a target to the unit's left", () => {
    expect(aimWeaponAngles(ORIGIN, LEFT).heading).toBeCloseTo(Math.PI / 2);
  });

  it("is negative for a target to the unit's right", () => {
    expect(aimWeaponAngles(ORIGIN, RIGHT).heading).toBeCloseTo(-Math.PI / 2);
  });

  it("is zero straight ahead", () => {
    expect(aimWeaponAngles(ORIGIN, FRONT).heading).toBeCloseTo(0);
  });

  /** `pitch = asin(dir · updir)`, so above the aim piece is positive. */
  it("pitches up for a target above the aim piece", () => {
    expect(aimWeaponAngles(ORIGIN, [0, 10, 10]).pitch).toBeCloseTo(Math.PI / 4);
  });

  it("pitches down for one below it", () => {
    expect(aimWeaponAngles(ORIGIN, [0, -10, 10]).pitch).toBeCloseTo(
      -Math.PI / 4,
    );
  });

  /** The aim is measured from the piece, not from the unit's origin: a turret
   *  high on the hull looks down at something the hull would look level at. */
  it("measures from the piece it is given", () => {
    expect(aimWeaponAngles([0, 10, 0], FRONT).pitch).toBeCloseTo(-Math.PI / 4);
  });
});

describe("startBuildingAngles", () => {
  /**
   * `rts/Sim/Units/UnitTypes/Builder.cpp:942-955`:
   *
   *   h = GetHeadingFromVectorF(dir.x, dir.z)
   *   script->StartBuilding(ClampRadPi(h - heading*TAANG2RAD), p - pitch)
   *
   * No projection onto `rightdir` and no negation, so `h` is `atan2(x, z)`
   * directly. The unit's own heading is zero in the editor, and `pitch` is
   * `asin(frontdir·updir)`, which is zero on flat ground. Both conventions
   * still agree: a target at `+x` is to the unit's left and gives `+PI/2`.
   */
  it("is positive for a target to the unit's left", () => {
    expect(startBuildingAngles(ORIGIN, LEFT).heading).toBeCloseTo(Math.PI / 2);
  });

  it("is negative for a target to the unit's right", () => {
    expect(startBuildingAngles(ORIGIN, RIGHT).heading).toBeCloseTo(
      -Math.PI / 2,
    );
  });

  /** Measured from `midPos`, which is the whole reason the engine uses it: a
   *  unit whose mid is up in the air aims down at a build on the ground. */
  it("moves with the unit's mid point", () => {
    const level = startBuildingAngles(ORIGIN, FRONT).pitch;
    const raised = startBuildingAngles([0, 20, 0], FRONT).pitch;
    expect(level).toBeCloseTo(0);
    expect(raised).toBeLessThan(-0.5);
  });
});

describe("resolveScenario", () => {
  function context(overrides: Partial<AimContext> = {}): AimContext {
    return {
      radius: 10,
      mid: ORIGIN,
      pieceRest: new Map([["flare", [0, 0, 0] as [number, number, number]]]),
      probed: (callin) => (callin === "AimFromWeapon1" ? "flare" : null),
      ...overrides,
    };
  }

  const firing: Scenario = {
    id: "t",
    label: "t",
    description: "t",
    events: [
      { frame: 0, callin: "Create" },
      {
        frame: 10,
        callin: "AimWeapon1",
        aimAtStandIn: { from: "AimFromWeapon" },
      },
    ],
    standIn: { keys: [{ frame: 10, pos: [1, 0, 2] }] },
  };

  it("replaces the marker with the two angles the engine would hand over", () => {
    const { events } = resolveScenario(firing, context());
    const aim = events.find((e) => e.callin === "AimWeapon1");
    expect(aim?.aimAtStandIn).toBeUndefined();
    // The stand-in's middle is one radius to the left and two ahead, plus the
    // height of its own middle above its base.
    expect(aim?.args?.[0]).toBeCloseTo(Math.atan2(10, 20));
    expect(aim?.args).toHaveLength(2);
  });

  it("leaves an event with no marker exactly as it was", () => {
    const { events } = resolveScenario(firing, context());
    expect(events[0]).toEqual({ frame: 0, callin: "Create" });
  });

  /**
   * The rest position of the piece the probe names, not the unit's origin. A
   * turret on top of a hull aims down at a stand-in the origin would aim level
   * at, which is the difference the whole preview exists to show.
   */
  it("aims from the piece the probe named", () => {
    const high = context({
      pieceRest: new Map([["flare", [0, 30, 0] as [number, number, number]]]),
    });
    const { events } = resolveScenario(firing, high);
    const aim = events.find((e) => e.callin === "AimWeapon1");
    expect(aim?.args?.[1]).toBeLessThan(-0.5);
  });

  /** A script that names no aim piece still gets angles, measured from the
   *  unit's origin, and the panel is told why they are approximate. */
  it("falls back to the unit's origin and says so", () => {
    const blind = context({ probed: () => null });
    const { events, notes } = resolveScenario(firing, blind);
    const aim = events.find((e) => e.callin === "AimWeapon1");
    expect(aim?.args).toHaveLength(2);
    expect(notes.join(" ")).toContain("AimFromWeapon1");
  });

  it("uses the builder's own formula for a midPos marker", () => {
    const building: Scenario = {
      ...firing,
      events: [
        {
          frame: 10,
          callin: "StartBuilding",
          aimAtStandIn: { from: "midPos" },
        },
      ],
    };
    const raised = context({ mid: [0, 40, 0] });
    const { events } = resolveScenario(building, raised);
    expect(events[0].args?.[1]).toBeLessThan(-0.5);
  });

  it("has nothing to aim at in a scenario with no track", () => {
    const { events, notes } = resolveScenario(
      { ...firing, standIn: undefined },
      context(),
    );
    expect(events.find((e) => e.callin === "AimWeapon1")?.args).toEqual([0, 0]);
    expect(notes.join(" ")).toContain("no stand-in");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/lego/aimResolver.test.ts`
Expected: FAIL, "Failed to resolve import ./aimResolver".

- [ ] **Step 3: Add the marker to `ScriptEvent`**

In `src/lego/scriptPlayback.ts`, inside `ScriptEvent` (`:15-24`), after `ambient`:

```ts
  /**
   * Work this event's arguments out from where the stand-in is on its frame,
   * rather than taking them as literals.
   *
   * A literal aim is a number somebody picked, and a script that aims at it
   * correctly looks exactly like one that does not. `aimResolver.ts` replaces
   * the marker with `args` before the run, using the engine's own formula:
   * `AimFromWeapon` measures from the piece that call-in names
   * (`rts/Sim/Weapons/Weapon.cpp:410-424`), `midPos` from the unit's mid
   * (`rts/Sim/Units/UnitTypes/Builder.cpp:942-955`).
   */
  aimAtStandIn?: { from: "AimFromWeapon" | "midPos" };
```

- [ ] **Step 4: Write `src/lego/aimResolver.ts`**

```ts
/**
 * Turn "aim at the stand-in" into the two angles the engine would hand a
 * script.
 *
 * Pure: a scenario and some measurements of the model go in, a scenario whose
 * aiming call-ins carry concrete radians comes out. Nothing here runs a script
 * or touches a scene.
 *
 * The two call-ins do not share a formula, and the difference is not cosmetic.
 * `AimWeapon` projects the wanted direction onto the unit's own basis and
 * negates the heading (`rts/Sim/Weapons/Weapon.cpp:410-424`). `StartBuilding`
 * takes the world heading minus the unit's own and does not negate
 * (`rts/Sim/Units/UnitTypes/Builder.cpp:942-955`). Both land in the same
 * convention, which is the thing worth knowing and the thing the tests assert:
 * a positive heading means the target is to the unit's left, a positive pitch
 * means above.
 *
 * Aiming is measured from a piece's rest position, not from where the piece is
 * on the frame the call-in fires. The engine uses the live animated position,
 * but the arguments have to be known before the script runs, so reading the
 * animated position would be circular. A turret's pivot barely moves relative
 * to its unit, so the error is small, and a second pass to close it would
 * double the latency of every scrub.
 */

import type { Scenario, ScriptEvent, StandInTrack } from "./scriptPlayback";
import { STAND_IN_MID_Y, standInAt } from "./standIn";

type Vec3 = [number, number, number];

/** What the resolver has to be told about the model to do its arithmetic. */
export interface AimContext {
  /** The stand-in's radius beside this unit, in elmos. */
  radius: number;
  /** The unit's aim point, which is also the mid the engine builds from. */
  mid: Vec3;
  /** Where each piece rests in unit space, by name. */
  pieceRest: Map<string, Vec3>;
  /** The first piece a probe named for a call-in, or null for none. */
  probed: (callin: string) => string | null;
}

export interface ResolvedScenario {
  events: ScriptEvent[];
  /** What could not be worked out, for the panel to show. */
  notes: string[];
}

/**
 * Where the stand-in's middle is on one frame, in unit space.
 *
 * Its middle rather than its base, because that is what a weapon aims at: the
 * engine fires at a unit's `aimPos`, which sits inside the unit rather than on
 * the ground under it.
 */
export function standInMid(
  track: StandInTrack,
  frame: number,
  radius: number,
): Vec3 | null {
  const pose = standInAt(track, frame, radius);
  if (!pose) return null;
  return [pose.pos[0], pose.pos[1] + STAND_IN_MID_Y * radius, pose.pos[2]];
}

/**
 * The heading and pitch `AimWeapon` is handed, from a piece to a target.
 *
 * `rts/Sim/Weapons/Weapon.cpp:410-424`, written out rather than reduced so it
 * can be read against the engine line for line. With the unit at heading zero
 * on flat ground its basis is the model's own: `frontdir` is `+z`, `updir` is
 * `+y`, and `rightdir` is `(-1,0,0)` (`rts/Sim/Objects/SolidObject.cpp:440`
 * with `GetVectorFromHeading(0)` being `(0,0,1)`). The editor never has a unit
 * at any other heading or on any other ground.
 */
export function aimWeaponAngles(
  from: Vec3,
  to: Vec3,
): { heading: number; pitch: number } {
  const dir = normalize([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);

  const localX = -dir[0]; // dir · rightdir
  const localY = dir[1]; //  dir · updir
  const localZ = dir[2]; //  dir · frontdir

  const heading = headingFromVector(localX, localZ);
  return {
    heading: clampRadPi(-heading),
    pitch: Math.asin(Math.min(Math.max(localY, -1), 1)),
  };
}

/**
 * The heading and pitch `StartBuilding` is handed, from the unit's mid to a
 * build position.
 *
 * `rts/Sim/Units/UnitTypes/Builder.cpp:942-955`. Two terms in that line are
 * zero here and are left out rather than written as `- 0`: the unit's own
 * heading, which is zero in the editor, and `asin(frontdir·updir)`, which is
 * zero for a unit on flat ground, which is the only ground the builder draws.
 */
export function startBuildingAngles(
  mid: Vec3,
  to: Vec3,
): { heading: number; pitch: number } {
  const dir = normalize([to[0] - mid[0], to[1] - mid[1], to[2] - mid[2]]);
  return {
    heading: clampRadPi(headingFromVector(dir[0], dir[2])),
    pitch: Math.asin(Math.min(Math.max(dir[1], -1), 1)),
  };
}

/**
 * A scenario with every `aimAtStandIn` marker turned into real arguments.
 *
 * An event whose angles cannot be worked out still fires, aiming straight
 * ahead and level, and the reason goes in `notes`. Dropping the call-in would
 * leave the preview showing a unit that never aims, which reads as the
 * script's fault rather than as the preview's.
 */
export function resolveScenario(
  scenario: Scenario,
  ctx: AimContext,
): ResolvedScenario {
  const notes: string[] = [];
  const track = scenario.standIn;

  const events = scenario.events.map((event) => {
    const marker = event.aimAtStandIn;
    if (!marker) return event;
    const { aimAtStandIn: _marker, ...rest } = event;

    const target = track ? standInMid(track, event.frame, ctx.radius) : null;
    if (!target) {
      notes.push(
        `${event.callin} aims at a stand-in, and this scenario places no stand-in on frame ${event.frame}. It is aimed straight ahead instead.`,
      );
      return { ...rest, args: [0, 0] };
    }

    if (marker.from === "midPos") {
      const { heading, pitch } = startBuildingAngles(ctx.mid, target);
      return { ...rest, args: [heading, pitch] };
    }

    // `AimFromWeapon1` rather than `AimFromWeapon`: the marker names the
    // engine's concept, the probe asks for the weapon the scenario drives, and
    // every scenario here drives weapon 1.
    const callin = "AimFromWeapon1";
    const piece = ctx.probed(callin);
    const from = piece ? ctx.pieceRest.get(piece) : undefined;
    if (!from) {
      notes.push(
        `This script names no ${callin} piece, so the aim is measured from the unit's origin rather than from where its weapon sits.`,
      );
    }
    const { heading, pitch } = aimWeaponAngles(from ?? [0, 0, 0], target);
    return { ...rest, args: [heading, pitch] };
  });

  return { events, notes };
}

/**
 * `GetHeadingFromVectorF` in `rts/System/SpringMath.inl:38-62`.
 *
 * That function is a polynomial approximation of `atan2(dx, dz)`, written for
 * a simulation that has to give bit-identical answers on every machine in the
 * game. A preview has no such obligation and wants the accurate answer, so
 * this is the function the engine's version approximates rather than a copy of
 * the approximation.
 */
function headingFromVector(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** `ClampRadPi` in `rts/System/SpringMath.inl:171-182`: an angle brought into
 *  -PI..PI. */
function clampRadPi(angle: number): number {
  const wrapped = angle - Math.PI * 2 * Math.floor(angle / (Math.PI * 2));
  return wrapped >= Math.PI ? wrapped - Math.PI * 2 : wrapped;
}

/** A direction, or straight ahead when the two points are the same and there
 *  is no direction to have. */
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 1];
  return [v[0] / length, v[1] / length, v[2] / length];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test src/lego/aimResolver.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lego/aimResolver.ts src/lego/aimResolver.test.ts src/lego/scriptPlayback.ts
git commit -m "Work an aim out from where the stand-in is, using the engine's formula"
```

---

### Task 4: The scenarios

**Files:**
- Modify: `src/lego/scriptPlayback.ts:148-252`
- Test: `src/lego/scriptPlayback.test.ts`

**Interfaces:**
- Consumes: `StandInTrack` and `aimAtStandIn` from Tasks 1 and 3.
- Produces: `building`, `firing` and `building-factory` carrying tracks, and two new scenarios, `transport-load` and `transport-unload`.

- [ ] **Step 1: Write the failing test**

Replace the `keep the mobile builder aiming where it was told to` test in `src/lego/scriptPlayback.test.ts` (`:127-134`) with:

```ts
  /** The mobile builder aims at the stand-in rather than at two numbers
   *  somebody picked, which is the only way a wrong aim is visible. */
  it("aims the mobile builder at its stand-in", () => {
    const build = scenarioById("building")?.events.find(
      (e) => e.callin === "StartBuilding",
    );

    expect(build?.aimAtStandIn).toEqual({ from: "midPos" });
    expect(build?.args).toBeUndefined();
  });

  it("aims the weapon at its stand-in from the aim piece", () => {
    const aim = scenarioById("firing")?.events.find(
      (e) => e.callin === "AimWeapon1",
    );

    expect(aim?.aimAtStandIn).toEqual({ from: "AimFromWeapon" });
    expect(aim?.args).toBeUndefined();
  });

  /** Every event that aims at a stand-in is in a scenario that has one, and
   *  every track's keys are inside the preview. */
  it("never aims at a stand-in a scenario does not place", () => {
    for (const scenario of SCENARIOS) {
      for (const event of scenario.events) {
        if (!event.aimAtStandIn) continue;
        expect(scenario.standIn?.keys.length ?? 0).toBeGreaterThan(0);
      }
      for (const key of scenario.standIn?.keys ?? []) {
        expect(key.frame).toBeGreaterThanOrEqual(0);
        expect(key.frame).toBeLessThan(PREVIEW_FRAMES);
      }
    }
  });

  /**
   * A factory spawns what it builds at the piece `QueryBuildInfo` names
   * (`rts/Sim/Units/UnitTypes/Factory.cpp:95-101,178`), and leaves it there.
   * It does not carry it, so the stand-in sits at the piece's rest position
   * rather than riding it.
   */
  it("puts a factory's stand-in on its build piece, sitting still", () => {
    const track = scenarioById("building-factory")?.standIn;
    expect(track?.attach).toEqual({
      from: "QueryBuildInfo",
      frame: at(1.5),
      until: null,
      follow: false,
    });
  });

  /**
   * Air transport, which is the only kind in scope. The engine's air arm calls
   * `BeginTransport` then attaches with the piece `QueryTransport` names
   * (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1448-1455`). `TransportPickup` is
   * the ground and ship arm and is deliberately absent.
   */
  it("loads a transport the way the engine's air arm does", () => {
    const load = scenarioById("transport-load");
    const callins = load?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("BeginTransport");
    expect(callins).not.toContain("TransportPickup");
    expect(load?.standIn?.attach?.from).toBe("QueryTransport");
    expect(load?.standIn?.attach?.follow).toBe(true);
    // Attached from the frame the transport is told it has a passenger.
    const begin = load?.events.find((e) => e.callin === "BeginTransport");
    expect(load?.standIn?.attach?.frame).toBe(begin?.frame);
  });

  /**
   * `StartUnload` is not here on purpose: nothing in `rts/` outside the script
   * interface files calls it, the same reason `QueryLandingPad` has no
   * scenario.
   */
  it("unloads with the two call-ins the engine actually fires", () => {
    const unload = scenarioById("transport-unload");
    const callins = unload?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("TransportDrop");
    expect(callins).toContain("EndTransport");
    expect(callins).not.toContain("StartUnload");
    // It comes off on the frame it is dropped, and not before.
    const drop = unload?.events.find((e) => e.callin === "TransportDrop");
    expect(unload?.standIn?.attach?.until).toBe(drop?.frame);
  });

  /** `TransportDrop` takes a unit id then x, y and z in Lua, which is the form
   *  the scenarios are written in. `LuaUnitScript.cpp:806-826`. */
  it("writes the transport call-ins in their Lua form", () => {
    const unload = scenarioById("transport-unload");
    expect(
      unload?.events.find((e) => e.callin === "TransportDrop")?.args,
    ).toHaveLength(4);
    expect(
      scenarioById("transport-load")?.events.find(
        (e) => e.callin === "BeginTransport",
      )?.args,
    ).toHaveLength(1);
  });
```

Add `at` to the imports at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/lego/scriptPlayback.test.ts`
Expected: FAIL, several, starting with `aimAtStandIn` being undefined on the builder's event.

- [ ] **Step 3: Rewrite the scenarios**

Above `SCENARIOS` in `src/lego/scriptPlayback.ts`, add:

```ts
/**
 * The stand-in that stands in for a passenger, in the Lua argument form.
 *
 * `BeginTransport`, `QueryTransport` and `TransportDrop` all take a unit id in
 * Lua where COB takes the passenger's model height or a packed position
 * (`rts/Sim/Units/Scripts/LuaUnitScript.cpp:139-141,787-826` against
 * `CobInstance.cpp:355-395`). The scenario writes the Lua form and the COB
 * runtime converts, which is how radians are already handled.
 *
 * The preview has no unit table for a script to look this up in, so the number
 * only has to be a plausible id: what a script does with it is open a door.
 */
const STAND_IN_UNIT_ID = 1;
```

Replace the `building` scenario's events and add a track:

```ts
  {
    id: "building",
    label: "Building (mobile)",
    description:
      "A construction unit reaching one way, stopping, then reaching the other, with something there to build. Its nanolathe is aimed, so this is the one with angles in it.",
    events: [
      ...CREATED,
      // No literal angles. `aimResolver.ts` works them out from where the
      // stand-in is on each of these frames, using the builder's own formula
      // (`rts/Sim/Units/UnitTypes/Builder.cpp:942-955`), so an arm that aims
      // at the wrong place is visibly aiming at the wrong place.
      {
        frame: at(0.5),
        callin: "StartBuilding",
        aimAtStandIn: { from: "midPos" },
      },
      { frame: at(2.5), callin: "StopBuilding" },
      {
        frame: at(3.5),
        callin: "StartBuilding",
        aimAtStandIn: { from: "midPos" },
      },
      { frame: at(5.5), callin: "StopBuilding" },
    ],
    // On the ground ahead and to one side, then across to the other during the
    // gap between the two builds, so the arm is seen to follow it.
    standIn: {
      keys: [
        { frame: 0, pos: [1.6, 0, 2.6] },
        { frame: at(2.5), pos: [1.6, 0, 2.6] },
        { frame: at(3.5), pos: [-1.6, 0, 2.6] },
        { frame: at(5.5), pos: [-1.6, 0, 2.6] },
      ],
    },
  },
```

Replace the `building-factory` scenario's track. Its events are unchanged:

```ts
    standIn: {
      // Nowhere until the factory starts building. A key on the same frame the
      // attach begins, so the keyed position is never what is drawn.
      keys: [{ frame: at(1.5), pos: [0, 0, 0] }],
      // A factory spawns what it builds at the world position of the piece
      // `QueryBuildInfo` names, and leaves it there
      // (`rts/Sim/Units/UnitTypes/Factory.cpp:95-101,178`). It does not carry
      // it, so the stand-in sits at the piece's rest position rather than
      // riding it through whatever the doors do.
      attach: {
        from: "QueryBuildInfo",
        frame: at(1.5),
        until: null,
        follow: false,
      },
    },
```

Replace the `firing` scenario's events and add a track:

```ts
    events: [
      ...CREATED,
      // Aimed at the stand-in rather than at two numbers, and measured from
      // the piece `AimFromWeapon1` names, as the engine measures it
      // (`rts/Sim/Weapons/Weapon.cpp:241-244,286-304,410-424`).
      {
        frame: at(0.5),
        callin: "AimWeapon1",
        aimAtStandIn: { from: "AimFromWeapon" },
      },
      { frame: at(2), callin: "Shot1" },
      {
        frame: at(3),
        callin: "AimWeapon1",
        aimAtStandIn: { from: "AimFromWeapon" },
      },
      { frame: at(4.5), callin: "Shot1" },
    ],
    // Off the ground and well out, so the second aim differs from the first in
    // pitch as well as heading and a barrel that only turns is obvious.
    standIn: {
      keys: [
        { frame: 0, pos: [2.6, 2.2, 4] },
        { frame: at(2), pos: [2.6, 2.2, 4] },
        { frame: at(3), pos: [-2.6, 0.6, 4] },
        { frame: at(5.5), pos: [-2.6, 0.6, 4] },
      ],
    },
  },
```

Append the two new scenarios after `firing`:

```ts
  {
    id: "transport-load",
    label: "Loading a transport",
    description:
      "An air transport picking something up: it is told what it is carrying, and the stand-in rides the piece the script names for it.",
    events: [
      ...CREATED,
      // The engine's air arm calls `BeginTransport` and then attaches with the
      // piece `QueryTransport` names
      // (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1448-1455`). `TransportPickup`
      // is the ground and ship arm, which needs the attach piece the script
      // chooses for itself and is not previewable yet.
      {
        frame: at(2),
        callin: "BeginTransport",
        args: [STAND_IN_UNIT_ID],
      },
    ],
    standIn: {
      keys: [
        // Approaching on the ground, from in front.
        { frame: 0, pos: [0, 0, 4.5] },
        { frame: at(2), pos: [0, 0, 1] },
      ],
      attach: {
        from: "QueryTransport",
        frame: at(2),
        until: null,
        follow: true,
      },
    },
  },
  {
    id: "transport-unload",
    label: "Unloading a transport",
    description:
      "The same transport putting its passenger down: the stand-in comes off the piece it was riding and settles below.",
    events: [
      ...CREATED,
      // `TransportDrop(unitID, x, y, z)` in the Lua form
      // (`rts/Sim/Units/Scripts/LuaUnitScript.cpp:806-826`). The position is
      // where the passenger is going, which is the ground under the transport.
      {
        frame: at(2.5),
        callin: "TransportDrop",
        args: [STAND_IN_UNIT_ID, 0, 0, 0],
      },
      // Once the last passenger is off (`MobileCAI.cpp:2094-2098`).
      { frame: at(3), callin: "EndTransport" },
    ],
    standIn: {
      keys: [
        // Measured from the piece it was riding, so it leaves from where the
        // transport was holding it rather than from the unit's origin.
        { frame: at(2.5), pos: [0, 0, 0], fromAttachPiece: true },
        { frame: at(4), pos: [0, -1.6, -1.2], fromAttachPiece: true },
        { frame: at(6), pos: [0, -1.6, -1.2], fromAttachPiece: true },
      ],
      attach: {
        from: "QueryTransport",
        frame: 0,
        until: at(2.5),
        follow: true,
      },
    },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/lego/scriptPlayback.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/scriptPlayback.test.ts
git commit -m "Give the scenarios something to aim at, build and carry"
```

---

### Task 5: The COB transport argument forms

Both runtimes are handed the same scenario, and the two want different numbers for the same call-in. `cobrun.rs` already handles that for angles. This adds the transport call-ins.

**Files:**
- Modify: `crates/tauri-plugin-coilbox-anim/src/cobrun.rs:198-206, 405-420`
- Test: `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`

**Interfaces:**
- Consumes: the Lua-form scenarios from Task 4.
- Produces: `fn cob_args(callin: &str, args: &[f64]) -> Vec<i32>` in `cobrun.rs`, replacing the inline `takes_angles` scaling at `:413-418`.

- [ ] **Step 1: Write the failing test**

Append inside the same `mod` the angle test lives in, in `crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs`. Read `pose` and `close` in that file first and keep their conventions rather than these.

```rust
    /// COB identifies a passenger by its model height in 65536ths, not by a
    /// unit id: `CCobInstance::BeginTransport` at
    /// `rts/Sim/Units/Scripts/CobInstance.cpp:355-360`. The scenario is
    /// written in the Lua form, so the runtime converts, exactly as it does
    /// for radians.
    #[test]
    fn hands_begin_transport_a_height_rather_than_a_unit_id() {
        // BeginTransport takes one argument and moves the base by it.
        let mut begin = vec![op("CREATE_LOCAL_VAR")];
        begin.extend([op("PUSH_LOCAL_VAR"), 0]);
        begin.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("BeginTransport", begin)], PIECES, 0);
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "BeginTransport".to_string(),
                // The stand-in's height in elmos, which is what the scenario's
                // single argument means once the runtime has it.
                args: vec![12.0],
                ambient: false,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        // 12 elmos as 65536ths, read back out through the distance scale.
        assert!(close(pose(&timeline, 0, "base")[2], 12.0));
    }

    /// `CCobInstance::TransportDrop` packs x and z into one word and drops y
    /// entirely (`CobInstance.cpp:385-395`, `CobInstance.h:10`), where Lua
    /// takes four separate numbers.
    #[test]
    fn packs_a_transport_drop_position_the_way_a_cob_reads_it() {
        // TransportDrop takes two arguments in COB. Move by the second.
        let mut drop = vec![op("CREATE_LOCAL_VAR"), op("CREATE_LOCAL_VAR")];
        drop.extend([op("PUSH_LOCAL_VAR"), 1]);
        drop.extend([op("MOVE_NOW"), 0, 0, op("RETURN")]);

        let bytes = build(&[("TransportDrop", drop)], PIECES, 0);
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "TransportDrop".to_string(),
                // Lua's (unitID, x, y, z).
                args: vec![1.0, 3.0, 9.0, 5.0],
                ambient: false,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        // PACKXZ(3, 5) is (3 << 16) + 5, which the distance scale reads back
        // as 3 and a very small fraction. The y of 9 is nowhere in it.
        let packed = f64::from((3i32 << 16) + 5) / 65536.0;
        assert!((pose(&timeline, 0, "base")[0] - packed).abs() < 1e-4);
    }

    /// A call-in that takes plain numbers is still handed them unchanged, so
    /// the conversions above cannot leak into everything else.
    #[test]
    fn leaves_an_ordinary_callins_arguments_alone() {
        let mut hit = vec![op("CREATE_LOCAL_VAR")];
        hit.extend([op("PUSH_LOCAL_VAR"), 0]);
        hit.extend([op("MOVE_NOW"), 0, 2, op("RETURN")]);

        let bytes = build(&[("HitByWeapon", hit)], PIECES, 0);
        let timeline = run(
            &bytes,
            &model_pieces(),
            &[ScriptEvent {
                frame: 0,
                callin: "HitByWeapon".to_string(),
                args: vec![7.0],
                ambient: false,
            }],
            3,
            &[],
            &HashMap::new(),
        );

        // Seven straight through, read back out through the distance scale.
        assert!(close(pose(&timeline, 0, "base")[2], 7.0 / 65536.0));
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p tauri-plugin-coilbox-anim transport`
Expected: FAIL. `BeginTransport` arrives as 12 rather than 12 * 65536, and `TransportDrop` arrives with four arguments rather than two.

- [ ] **Step 3: Replace the inline scaling with a per-call-in conversion**

In `crates/tauri-plugin-coilbox-anim/src/cobrun.rs`, replace `fn takes_angles` (`:198-206`) with:

```rust
/// The arguments a `.cob` expects for a call-in, from the Lua form a scenario
/// is written in.
///
/// The two runtimes are handed the same scenario and do not want the same
/// numbers. Every difference below is the engine's, and each one is a
/// different kind of difference:
///
/// - Aiming and building are handed angles. Lua takes radians, COB counts
///   65536ths of a circle (`CobInstance.cpp:45-56`).
/// - A transport identifies its passenger by unit id in Lua and by model
///   height in 65536ths in COB (`LuaUnitScript.cpp:139-141` against
///   `CobInstance.cpp:355-372`). The scenario's one number is the stand-in's
///   height in elmos, which is the only form both can be built from.
/// - `TransportDrop` takes x, y and z in Lua and one packed word in COB, with
///   y dropped entirely (`CobInstance.cpp:385-395`, `PACKXZ` in
///   `CobInstance.h:10`).
///
/// Everything else is handed straight through.
fn cob_args(callin: &str, args: &[f64]) -> Vec<i32> {
    let lower = callin.to_ascii_lowercase();

    if lower.starts_with("aim") || lower == "startbuilding" {
        return args.iter().map(|arg| (arg * RAD2TAANG) as i32).collect();
    }

    if lower == "begintransport" {
        return args
            .iter()
            .map(|height| (height * 65536.0) as i32)
            .collect();
    }

    if lower == "transportdrop" {
        // (unitID, x, y, z) becomes (unitID, PACKXZ(x, z)).
        let id = args.first().copied().unwrap_or(0.0) as i32;
        let x = args.get(1).copied().unwrap_or(0.0) as i32;
        let z = args.get(3).copied().unwrap_or(0.0) as i32;
        return vec![id, (x << 16) + (z & 0xffff)];
    }

    args.iter().map(|arg| *arg as i32).collect()
}
```

Then replace the scaling at `:412-419` with:

```rust
            thread.data = cob_args(&event.callin, &event.args);
            thread.params = thread.data.len() as i32;
```

`QueryTransport` is not here. It is never fired as an event: it answers with a piece, and the preview asks it through the probe rather than driving it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-anim`
Expected: PASS, the whole crate's suite including the existing angle test.

- [ ] **Step 5: Format and lint**

```bash
cargo fmt --all
cargo clippy --all-targets -- -D warnings
```
Expected: no output from fmt, no warnings from clippy.

- [ ] **Step 6: Commit**

```bash
git add crates/tauri-plugin-coilbox-anim/src/cobrun.rs crates/tauri-plugin-coilbox-anim/src/cobrun_tests.rs
git commit -m "Hand a compiled script the transport arguments it counts in"
```

---

### Task 6: The stand-in's shape, as two candidates

Both candidates ship in this commit. Task 9 screenshots them, picks one and deletes the other. Building both and looking is what the spec asks for: silhouette legibility is judged by looking, not specified.

**Files:**
- Modify: `src/lego/standIn.ts`
- Test: `src/lego/standIn.test.ts`

**Interfaces:**
- Consumes: `standInRadius` and `STAND_IN_MID_Y` from Task 1.
- Produces: `STAND_IN_SHAPE: "wedge" | "glacis"`, `buildStandIn(radius: number): THREE.Group`, `disposeStandIn(group: THREE.Group): void`.

- [ ] **Step 1: Write the failing test**

Append to `src/lego/standIn.test.ts`:

```ts
describe("buildStandIn", () => {
  /** A view aid, never a piece. Nothing in the builder may select, hover or
   *  seat against it, which is how `referenceObject.ts` does it too. */
  it("is invisible to the pointer", () => {
    const group = buildStandIn(10);
    let meshes = 0;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes += 1;
        expect(child.raycast({} as never, [])).toBeUndefined();
      }
    });
    expect(meshes).toBeGreaterThan(0);
    disposeStandIn(group);
  });

  /** Sized in elmos with nothing rescaled, and standing on y = 0 the way the
   *  engine stands a unit, so a track's `y: 0` sits it on the ground. */
  it("is built to the radius it is given, standing on the ground", () => {
    const box = new THREE.Box3().setFromObject(buildStandIn(10));
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(10, 1);
    expect(box.min.x).toBeCloseTo(-10, 1);
  });

  /** The front reads from the silhouette: it sticks out further forward than
   *  it does back, so a shape seen from behind is not a shape seen in front. */
  it("is not the same front to back", () => {
    const box = new THREE.Box3().setFromObject(buildStandIn(10));
    expect(box.max.z).toBeGreaterThan(Math.abs(box.min.z));
  });

  /** Up reads from the silhouette too: the top is not the base. */
  it("is not the same upside down", () => {
    const group = buildStandIn(10);
    const box = new THREE.Box3().setFromObject(group);
    // Narrower at the top than at the base, so a stand-in that has somehow
    // been turned over is obvious rather than merely wrong.
    const top = widthAt(group, box.max.y * 0.9);
    const base = widthAt(group, box.min.y + 0.01);
    expect(top).toBeLessThan(base);
  });
});

/** How wide the shape is across x at one height, read off its vertices. */
function widthAt(group: THREE.Group, y: number): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const pos = child.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - y) > 0.5) continue;
      min = Math.min(min, pos.getX(i));
      max = Math.max(max, pos.getX(i));
    }
  });
  return max - min;
}
```

Add `import * as THREE from "three";` and `buildStandIn`, `disposeStandIn` to the imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/lego/standIn.test.ts`
Expected: FAIL, `buildStandIn is not a function`.

- [ ] **Step 3: Implement both shapes**

Append to `src/lego/standIn.ts`:

```ts
import * as THREE from "three";

/**
 * Which of the two candidate shapes is built.
 *
 * Both are here because the spec asks for the silhouette to be judged by
 * looking rather than specified: the case that matters is a low rear angle,
 * where an upside-down sphere reads the same either way up. Screenshot both
 * in the real viewport, keep the one that reads, delete the other.
 */
export const STAND_IN_SHAPE: "wedge" | "glacis" = "wedge";

/**
 * Neutral grey. Every other colour in this scene means something specific -
 * violet is selection, orange is the collision volume, red is the aim point,
 * sky blue is the reference figure - and the stand-in is a unit rather than a
 * reading about one, so it takes none of them.
 */
const BODY_COLOUR = 0x9ca3af;
/**
 * The nose facet. Teal is the one place on the wheel nothing in this scene
 * already occupies, and it is what says which way the thing is facing from any
 * angle the silhouette alone does not.
 */
const NOSE_COLOUR = 0x14b8a6;

/** How tall the shape is, in multiples of its radius. `STAND_IN_MID_Y` is half
 *  this, which is where its middle sits. */
const HEIGHT = STAND_IN_MID_Y * 2;
/** How far past the radius the nose reaches, in multiples of the radius. What
 *  makes a shape seen from behind different from one seen in front. */
const NOSE_REACH = 1.35;

/** The panel texture's own size in pixels, and how many times it tiles across
 *  the shape. Small and plain on purpose: flat shading is what makes the
 *  facets readable, and a busy texture fights it. */
const PANEL_PIXELS = 64;
const PANEL_REPEAT = 3;

/**
 * The stand-in, in its own local space with its base on y = 0, as the engine
 * stands a unit.
 *
 * Purely a visual aid. It never carries a piece, is never selected, hovered,
 * baked or exported. The viewport positions and toggles it. This only builds
 * the shape.
 */
export function buildStandIn(radius: number): THREE.Group {
  const group = new THREE.Group();
  const texture = panelTexture();

  const body = new THREE.MeshStandardMaterial({
    color: BODY_COLOUR,
    map: texture,
    flatShading: true,
    roughness: 0.75,
    metalness: 0.05,
  });
  const nose = new THREE.MeshStandardMaterial({
    color: NOSE_COLOUR,
    map: texture,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.05,
  });

  const geometry =
    STAND_IN_SHAPE === "wedge" ? wedgeGeometry(radius) : glacisGeometry(radius);

  const mesh = new THREE.Mesh(geometry, [body, nose]);
  mesh.raycast = () => {};
  group.add(mesh);
  return group;
}

/**
 * Candidate one: a squat eight-sided prism with its front face pulled forward
 * into a wedge and a shallow dome on top.
 *
 * Facing reads from the wedge, up reads from the flat base against the dome.
 * Convex, with no moving parts.
 */
function wedgeGeometry(radius: number): THREE.BufferGeometry {
  const height = HEIGHT * radius;
  // Eight around, with the one at the front pushed out into the wedge.
  const base = ring(radius, 0, NOSE_REACH);
  const deck = ring(radius * 0.78, height * 0.72, NOSE_REACH);
  const apex: Vec3 = [0, height, 0];

  const body: number[] = [];
  const noseFaces: number[] = [];

  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length;
    // The two triangles of the skirt between base and deck. The pair carrying
    // the front vertex is the nose facet.
    const skirt = [
      ...base[i], ...base[j], ...deck[j],
      ...base[i], ...deck[j], ...deck[i],
    ];
    const isNose = i === 0 || j === 0;
    (isNose ? noseFaces : body).push(...skirt);
    // The dome: deck to apex.
    body.push(...deck[i], ...deck[j], ...apex);
    // The flat base, wound so it faces down.
    body.push(0, 0, 0, ...base[j], ...base[i]);
  }

  return grouped(body, noseFaces);
}

/**
 * Candidate two: a chamfered box whose front face rakes back from the base,
 * with a shallow roof ridge running front to back.
 *
 * The rake is a tank's glacis plate. Facing reads from the slope and from the
 * ridge's direction, up reads from the ridge itself.
 */
function glacisGeometry(radius: number): THREE.BufferGeometry {
  const h = HEIGHT * radius;
  const x = radius;
  const back = -radius;
  const front = radius * NOSE_REACH;

  // The deck, narrower and shorter than the base, with the front edge pulled
  // well back so the nose is a long slope rather than a wall.
  const dx = x * 0.72;
  const deckFront = radius * 0.35;
  const deckY = h * 0.75;
  // The ridge, one line down the middle of the deck.
  const ridgeY = h;

  const p = {
    baseBL: [-x, 0, back] as Vec3,
    baseBR: [x, 0, back] as Vec3,
    baseFL: [-x, 0, front] as Vec3,
    baseFR: [x, 0, front] as Vec3,
    deckBL: [-dx, deckY, back * 0.9] as Vec3,
    deckBR: [dx, deckY, back * 0.9] as Vec3,
    deckFL: [-dx, deckY, deckFront] as Vec3,
    deckFR: [dx, deckY, deckFront] as Vec3,
    ridgeB: [0, ridgeY, back * 0.75] as Vec3,
    ridgeF: [0, ridgeY, deckFront * 0.6] as Vec3,
  };

  const body: number[] = [];
  const noseFaces: number[] = [];

  // Base, facing down.
  body.push(...p.baseBL, ...p.baseFL, ...p.baseFR);
  body.push(...p.baseBL, ...p.baseFR, ...p.baseBR);
  // The glacis: base front edge up to the deck front edge. The nose facet.
  noseFaces.push(...p.baseFL, ...p.deckFL, ...p.deckFR);
  noseFaces.push(...p.baseFL, ...p.deckFR, ...p.baseFR);
  // Back.
  body.push(...p.baseBR, ...p.deckBR, ...p.deckBL);
  body.push(...p.baseBR, ...p.deckBL, ...p.baseBL);
  // Left and right skirts.
  body.push(...p.baseBL, ...p.deckBL, ...p.deckFL);
  body.push(...p.baseBL, ...p.deckFL, ...p.baseFL);
  body.push(...p.baseFR, ...p.deckFR, ...p.deckBR);
  body.push(...p.baseFR, ...p.deckBR, ...p.baseBR);
  // The roof: four faces up to the ridge, plus its two ends.
  body.push(...p.deckFL, ...p.ridgeF, ...p.ridgeB);
  body.push(...p.deckFL, ...p.ridgeB, ...p.deckBL);
  body.push(...p.deckFR, ...p.deckBR, ...p.ridgeB);
  body.push(...p.deckFR, ...p.ridgeB, ...p.ridgeF);
  body.push(...p.deckFL, ...p.deckFR, ...p.ridgeF);
  body.push(...p.deckBL, ...p.ridgeB, ...p.deckBR);

  return grouped(body, noseFaces);
}

/** A ring of eight points at one height, with the front one pushed out. */
function ring(radius: number, y: number, noseReach: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    // Starting at the front and going round, so index 0 is the nose.
    const angle = (i / 8) * Math.PI * 2;
    const reach = i === 0 ? noseReach : 1;
    points.push([
      Math.sin(angle) * radius,
      y,
      Math.cos(angle) * radius * reach,
    ]);
  }
  return points;
}

/**
 * One geometry in two material groups: the body, then the nose facet.
 *
 * Non-indexed and with normals computed per triangle, which is what flat
 * shading needs. Shared vertices would average the normals across a facet and
 * smooth away the very edges that make the shape readable.
 */
function grouped(body: number[], nose: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([...body, ...nose], 3),
  );
  geometry.computeVertexNormals();
  geometry.addGroup(0, body.length / 3, 0);
  geometry.addGroup(body.length / 3, nose.length / 3, 1);
  // Box-projected on x and z, which is enough for a tiling panel pattern on a
  // shape with no seams anyone will look at.
  const pos = geometry.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i);
    uv[i * 2 + 1] = pos.getZ(i) + pos.getY(i);
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * A small tiling grey panel pattern: panel lines on a light base, with a
 * little grain.
 *
 * Not a stone or metal photograph. Flat shading is what makes the facets
 * readable and a busy texture fights it, so this is enough to say "made of
 * something" and no more. Follows `environment.ts:223-273` for the
 * canvas-less path, since the tests run without a DOM.
 */
function panelTexture(): THREE.CanvasTexture | null {
  const canvas =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;

  canvas.width = PANEL_PIXELS;
  canvas.height = PANEL_PIXELS;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PANEL_PIXELS, PANEL_PIXELS);

  context.strokeStyle = "rgba(0, 0, 0, 0.22)";
  context.lineWidth = 1;
  const step = PANEL_PIXELS / 2;
  for (let at = 0; at <= PANEL_PIXELS; at += step) {
    context.beginPath();
    context.moveTo(at + 0.5, 0);
    context.lineTo(at + 0.5, PANEL_PIXELS);
    context.moveTo(0, at + 0.5);
    context.lineTo(PANEL_PIXELS, at + 0.5);
    context.stroke();
  }

  const image = context.getImageData(0, 0, PANEL_PIXELS, PANEL_PIXELS);
  for (let i = 0; i < image.data.length; i += 4) {
    const grain = Math.round((Math.random() - 0.5) * 18);
    image.data[i] += grain;
    image.data[i + 1] += grain;
    image.data[i + 2] += grain;
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(PANEL_REPEAT, PANEL_REPEAT);
  return texture;
}

/** Frees the geometry, materials and texture `buildStandIn` allocated. */
export function disposeStandIn(group: THREE.Group): void {
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.geometry.dispose();
    for (const material of [child.material].flat()) {
      (material as THREE.MeshStandardMaterial).map?.dispose();
      material.dispose();
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/lego/standIn.test.ts`
Expected: PASS.

If `is not the same upside down` fails for `glacis`, that is a real finding about that candidate and belongs in the screenshot comparison, not in a loosened test. Set `STAND_IN_SHAPE` to each value in turn, run, and record which passes.

- [ ] **Step 5: Commit**

```bash
git add src/lego/standIn.ts src/lego/standIn.test.ts
git commit -m "Build two candidate shapes for the stand-in"
```

---

### Task 7: Put the stand-in in the scene

**Files:**
- Modify: `src/lego/pages/components/sceneState.ts`
- Create: `src/lego/pages/components/standInPlayback.ts`
- Modify: `src/lego/pages/components/useScriptFrameStepping.ts`
- Modify: `src/lego/pages/components/ModelViewport.tsx`
- Test: `src/lego/pages/components/ModelViewport.dom.test.tsx`

**Interfaces:**

- Consumes, from `standIn.ts`: `standInAt`, `attachedAt`, `buildStandIn`, `disposeStandIn`, `standInRadius`.
- Consumes, from `scriptPlayback.ts`: `StandInTrack`.
- Produces, added to `SceneState`:
  ```ts
  standIn: THREE.Group
  disposeStandIn: () => void
  standInRadius: number
  ```
- Produces, from `standInPlayback.ts`:
  ```ts
  export interface StandInPlacement {
    track: StandInTrack | null
    /** The piece each attach source named, by call-in. Empty when the probe
     *  named none, which is what the panel reports. */
    attachPieces: Map<string, string>
    show: boolean
  }
  export function placeStandIn(
    state: SceneState,
    project: LegoProject,
    placement: StandInPlacement,
    frame: number,
  ): void
  ```

- [ ] **Step 1: Write the failing test**

Append to `src/lego/pages/components/ModelViewport.dom.test.tsx`. Follow that file's existing habit of driving one function with a hand-built state rather than rendering the component:

```ts
describe("placeStandIn", () => {
  /** Enough of a scene for `placeStandIn`: a group per piece, a stand-in, and
   *  a radius. Nothing here draws. */
  function standInScene() {
    const base = new THREE.Group();
    const arm = new THREE.Group();
    base.add(arm);
    return {
      standIn: new THREE.Group(),
      standInRadius: 10,
      rest: new Map([
        ["base", [0, 0, 0]],
        ["arm", [0, 0, 0]],
      ]),
      groups: new Map([
        ["base", base],
        ["arm", arm],
      ]),
    } as unknown as SceneState;
  }

  const doc = project(piece("base", null), piece("arm", "base"));

  it("shows nothing at all for a scenario with no track", () => {
    const state = standInScene();
    placeStandIn(
      state,
      doc,
      { track: null, attachPieces: new Map(), show: true },
      0,
    );
    expect(state.standIn.visible).toBe(false);
  });

  it("shows it where a track's keys put it", () => {
    const state = standInScene();
    placeStandIn(
      state,
      doc,
      {
        track: { keys: [{ frame: 0, pos: [1, 0, 2] }] },
        attachPieces: new Map(),
        show: true,
      },
      0,
    );
    expect(state.standIn.visible).toBe(true);
    expect(state.standIn.position.toArray()).toEqual([10, 0, 20]);
  });

  it("stays hidden while the toggle is off, track or no track", () => {
    const state = standInScene();
    placeStandIn(
      state,
      doc,
      {
        track: { keys: [{ frame: 0, pos: [1, 0, 2] }] },
        attachPieces: new Map(),
        show: false,
      },
      0,
    );
    expect(state.standIn.visible).toBe(false);
  });

  /** An attach that follows rides the piece wherever the pose put it, which is
   *  the whole point of previewing a transport. */
  it("rides the attach piece where the pose put it", () => {
    const state = standInScene();
    state.groups.get("arm")?.position.set(0, 7, 0);
    state.groups.get("base")?.position.set(3, 0, 0);
    placeStandIn(
      state,
      doc,
      {
        track: {
          keys: [{ frame: 0, pos: [0, 0, 0] }],
          attach: {
            from: "QueryTransport",
            frame: 0,
            until: null,
            follow: true,
          },
        },
        attachPieces: new Map([["QueryTransport", "arm"]]),
        show: true,
      },
      0,
    );
    expect(state.standIn.position.toArray()).toEqual([3, 7, 0]);
  });

  /**
   * A probe that named no piece leaves the stand-in on its last keyed
   * position rather than dropping it to the origin. Saying so is the panel's
   * job. Not lying about where it is, is this function's.
   */
  it("holds the keyed position when the probe named no piece", () => {
    const state = standInScene();
    placeStandIn(
      state,
      doc,
      {
        track: {
          keys: [{ frame: 0, pos: [0, 1, 4] }],
          attach: {
            from: "QueryTransport",
            frame: 0,
            until: null,
            follow: true,
          },
        },
        attachPieces: new Map(),
        show: true,
      },
      0,
    );
    expect(state.standIn.visible).toBe(true);
    expect(state.standIn.position.toArray()).toEqual([0, 10, 40]);
  });

  /** A key measured from the attach piece is measured from where that piece
   *  is, so a dropped passenger leaves from the transport rather than from the
   *  unit's origin. */
  it("measures a fromAttachPiece key from the piece", () => {
    const state = standInScene();
    state.groups.get("arm")?.position.set(0, 7, 0);
    placeStandIn(
      state,
      doc,
      {
        track: {
          keys: [{ frame: 0, pos: [0, -0.5, 0], fromAttachPiece: true }],
          attach: {
            from: "QueryTransport",
            frame: 0,
            until: 0,
            follow: true,
          },
        },
        attachPieces: new Map([["QueryTransport", "arm"]]),
        show: true,
      },
      0,
    );
    expect(state.standIn.position.toArray()).toEqual([0, 2, 0]);
  });
});
```

Add `placeStandIn` and `SceneState` to the imports. The scene groups need their world matrices up to date before `getWorldPosition` reads them, which `placeStandIn` handles.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/lego/pages/components/ModelViewport.dom.test.tsx`
Expected: FAIL, "Failed to resolve import ./standInPlayback".

- [ ] **Step 3: Add the three fields to `SceneState`**

In `src/lego/pages/components/sceneState.ts`, after the `reference` and `disposeReference` pair (`:63-69`):

```ts
  /** The crude second unit a scenario aims at, builds or carries. A view aid
   *  like `reference`, but rebuilt whenever the edited unit's size changes,
   *  because its own size comes from that. */
  standIn: THREE.Group;
  /** Frees whichever shape `standIn` currently is. */
  disposeStandIn: () => void;
  /** How big it was built, in elmos, so a track's radius multiples are read
   *  against the shape actually in the scene. */
  standInRadius: number;
```

- [ ] **Step 4: Write `standInPlayback.ts`**

```ts
/**
 * Put the stand-in where a scenario's track says it is on one frame.
 *
 * Called from the same places that pose the pieces, because it is the same
 * question asked about a different object: a running clock's tick, and the one
 * frame a paused run is held on. Keeping the two together is what stops the
 * stand-in lagging the unit by a frame while scrubbing.
 *
 * Pure with respect to time: everything it needs comes from the frame number,
 * so scrubbing back to a frame gives exactly the picture it gave before.
 */

import * as THREE from "three";

import type { LegoProject } from "../../model";
import type { StandInTrack } from "../../scriptPlayback";
import { attachedAt, standInAt } from "../../standIn";
import type { SceneState } from "./sceneState";

export interface StandInPlacement {
  /** The running scenario's track, or null when it defines none. */
  track: StandInTrack | null;
  /** The piece each attach source named, keyed by the call-in it came from.
   *  A source the probe answered nothing for is simply absent. */
  attachPieces: Map<string, string>;
  /** The viewport's own toggle. */
  show: boolean;
}

const WORLD = new THREE.Vector3();

export function placeStandIn(
  state: SceneState,
  project: LegoProject,
  { track, attachPieces, show }: StandInPlacement,
  frame: number,
): void {
  const pose = track ? standInAt(track, frame, state.standInRadius) : null;
  if (!show || !track || !pose) {
    state.standIn.visible = false;
    return;
  }
  state.standIn.visible = true;

  const attach = attachedAt(track, frame);
  const piece = attach ? attachPieces.get(attach.from) : undefined;
  const group = piece ? groupOfPiece(state, project, piece) : undefined;
  // The pose was written onto the groups a moment ago and nothing has rendered
  // since, so their world matrices are a frame out until this asks for them.
  group?.updateWorldMatrix(true, false);

  // Riding a piece: the stand-in takes that piece's position outright. Its own
  // keyed position says nothing while it is being carried.
  if (attach?.follow && group) {
    group.getWorldPosition(WORLD);
    state.standIn.position.copy(WORLD);
    state.standIn.rotation.set(0, pose.heading, 0);
    return;
  }

  // Sitting where a piece rests rather than riding it: a factory's build spot.
  // The rest offsets are what `showBaked` wrote, so this is the piece's place
  // before anything animated it.
  if (attach && !attach.follow && piece) {
    const rest = restOfPiece(state, project, piece);
    if (rest) {
      state.standIn.position.set(...rest);
      state.standIn.rotation.set(0, pose.heading, 0);
      return;
    }
  }

  // Loose, or attached to a piece the probe never named. A key measured from
  // the attach piece is offset from wherever that piece is, so a dropped
  // passenger leaves the transport rather than the unit's origin. With no
  // piece to measure from it falls back to the unit's origin, which is the
  // same answer an ordinary key gives.
  const origin = new THREE.Vector3();
  if (pose.fromAttachPiece && group) group.getWorldPosition(origin);
  state.standIn.position.set(
    origin.x + pose.pos[0],
    origin.y + pose.pos[1],
    origin.z + pose.pos[2],
  );
  state.standIn.rotation.set(0, pose.heading, 0);
}

/** The scene group standing for a piece, found by the piece's name because
 *  that is what a script probe answers with. */
function groupOfPiece(
  state: SceneState,
  project: LegoProject,
  name: string,
): THREE.Group | undefined {
  const piece = project.pieces.find((candidate) => candidate.name === name);
  return piece ? state.groups.get(piece.id) : undefined;
}

/** Where a piece rests, accumulated from the offsets playback wrote into
 *  `state.rest`, which is the bake rather than the document. */
function restOfPiece(
  state: SceneState,
  project: LegoProject,
  name: string,
): [number, number, number] | null {
  let piece = project.pieces.find((candidate) => candidate.name === name);
  const at: [number, number, number] = [0, 0, 0];
  while (piece) {
    const offset = state.rest.get(piece.id);
    if (!offset) return null;
    at[0] += offset[0];
    at[1] += offset[1];
    at[2] += offset[2];
    const parentId = piece.parentId;
    piece = parentId
      ? project.pieces.find((candidate) => candidate.id === parentId)
      : undefined;
  }
  return at;
}
```

- [ ] **Step 5: Call it from `useScriptFrameStepping`**

In `src/lego/pages/components/useScriptFrameStepping.ts`:

Add `standIn: StandInPlacement` to `ScriptFrameSteppingDeps`, destructure it, and add a ref beside the others so the running tick reads the current one without tearing the bake down:

```ts
  // Read inside the tick for the same reason the timeline is: switching
  // scenario must not rebuild the bake.
  const standInRef = useRef(standIn);
  standInRef.current = standIn;
```

In the running tick, after `applyTimeline(...)`:

```ts
          placeStandIn(
            state,
            projectRef.current,
            standInRef.current,
            frameAt(timeline, elapsed),
          );
```

and in the preset branch, which has no timeline and therefore no scenario:

```ts
          state.standIn.visible = false;
```

In the paused-frame effect, after `applyTimelineFrame(...)`:

```ts
    placeStandIn(
      state,
      projectRef.current,
      standInRef.current,
      clampFrame(scriptTimeline, scriptFrame),
    );
```

Add `standIn` to that effect's dependency array.

In the running effect's cleanup, beside `restoreFromPlayback(current)`:

```ts
      // Stopping puts the scene back to the built pose, and the built pose has
      // nothing standing beside it.
      current.standIn.visible = false;
```

- [ ] **Step 6: Build, dispose and toggle it in `ModelViewport.tsx`**

Add to the props' `scriptPlayback` block:

```ts
    /**
     * The running scenario's stand-in track and the pieces its attachments
     * name, or a null track when the scenario defines none.
     *
     * It rides with the playback props rather than in a block of its own
     * because it is part of what is playing: a track means nothing without
     * the timeline it is laid over.
     */
    standIn?: StandInPlacement;
```

Destructure it with `standIn = { track: null, attachPieces: new Map(), show: true }` as the default.

Add the toggle state beside the other view settings (`:503-509`):

```ts
  const [showStandIn, setShowStandIn] = useState(true);
```

On by default, because a scenario that defines a track wants it seen, and the toggle exists for getting it out of the way.

In the scene build, after the reference figure (`:616-619`):

```ts
      // The stand-in a scenario aims at, builds or carries. Hidden until a
      // scenario with a track plays, and rebuilt whenever the edited unit's
      // size changes, since its own size comes from that.
      const radius = standInRadius(unitBounds(project, pack, raw));
      const standInGroup = buildStandIn(radius);
      standInGroup.visible = false;
      scene.add(standInGroup);
```

Add the three `SceneState` fields to the `state` literal:

```ts
        standIn: standInGroup,
        disposeStandIn: () => disposeStandIn(standInGroup),
        standInRadius: radius,
```

In the disposer, beside `state.disposeReference()`:

```ts
          // Not `standInGroup`: the shape is rebuilt when the unit's size
          // changes, so the one in the scene may not be the one built here.
          state.disposeStandIn();
```

Add a hook that rebuilds it when the radius changes, next to the other `use*` calls:

```ts
  useStandInSize(sceneRef, project, pack, raw);
```

Write `useStandInSize` at the bottom of `ModelViewport.tsx`, beside `paintCompass`:

```ts
/**
 * Rebuild the stand-in when the unit it stands beside changes size.
 *
 * Its radius comes from the unit's own bounding box, so a unit growing from
 * one part to fifty would otherwise keep a stand-in sized for the first part.
 * Rebuilt rather than scaled, because a scaled shape carries a scaled texture
 * repeat and the panels stretch.
 */
function useStandInSize(
  sceneRef: React.RefObject<SceneState | null>,
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
) {
  const radius = standInRadius(unitBounds(project, pack, raw));
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || state.standInRadius === radius) return;
    const wasVisible = state.standIn.visible;
    const at = state.standIn.position.clone();
    const facing = state.standIn.rotation.y;
    state.scene.remove(state.standIn);
    state.disposeStandIn();

    const group = buildStandIn(radius);
    group.position.copy(at);
    group.rotation.set(0, facing, 0);
    group.visible = wasVisible;
    state.standIn = group;
    state.disposeStandIn = () => disposeStandIn(group);
    state.standInRadius = radius;
    state.scene.add(group);
    state.render();
  }, [sceneRef, radius]);
}
```

Add the toggle in `ViewControls`, between `ReferencePicker` and the shortcuts button:

```tsx
            <ViewToggle
              icon={Target}
              on={showStandIn}
              onChange={setShowStandIn}
              hideTitle="Hide the stand-in unit"
              showTitle="Show the stand-in unit, the thing a scenario aims at, builds or carries"
            />
```

`Target` from `lucide-react`. Pass the toggle down into the playback deps:

```ts
  useScriptFrameStepping(sceneRef, {
    ...
    standIn: { ...standIn, show: standIn.show && showStandIn },
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run test src/lego/pages/components/ModelViewport.dom.test.tsx`
Expected: PASS, 6 new tests plus the file's existing ones.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lego/pages/components/sceneState.ts src/lego/pages/components/standInPlayback.ts src/lego/pages/components/useScriptFrameStepping.ts src/lego/pages/components/ModelViewport.tsx src/lego/pages/components/ModelViewport.dom.test.tsx
git commit -m "Put the stand-in in the viewport, and place it per frame"
```

---

### Task 8: Probe, resolve and wire the panel

**Files:**
- Modify: `src/lego/pages/components/AnimationPanel.tsx`
- Modify: `src/lego/pages/BuilderPage.tsx`

**Interfaces:**

- Consumes: `resolveScenario` and `AimContext` from `aimResolver.ts`, `pieceWorldRest` from `s3oBuild.ts`, `standInRadius` from `standIn.ts`, `legoProbeScript` from `bindings.ts`.
- Produces: `AnimationPanel` gains props `bounds`, `pack`, `raw` and `onStandIn`. `BuilderPage` holds a `standIn` state and hands it to `ModelViewport`.

- [ ] **Step 1: Add the probe and the resolve to `AnimationPanel`**

The three call-ins a scenario can need a piece for, above the component:

```ts
/**
 * The call-ins a scenario asks a script to name a piece for.
 *
 * All three answer with a piece rather than doing anything, which is what
 * makes them safe to call directly rather than drive over frames: see
 * `legoProbeScript`. The answer is a fixed piece in every script anyone ships.
 * Reading a real per-call return value means a new channel out of both
 * runtimes, which is a project of its own.
 */
const STAND_IN_PROBES = ["AimFromWeapon1", "QueryBuildInfo", "QueryTransport"];

/** What a scenario's attachment could not be resolved to, in words. */
function attachNotes(
  scenario: Scenario,
  named: Map<string, string>,
  isCompiled: boolean,
): string[] {
  const attach = scenario.standIn?.attach;
  if (!attach || named.has(attach.from)) return [];
  if (isCompiled) {
    return [
      `This unit's script is compiled, and a compiled script cannot be asked which piece its ${attach.from} names. The stand-in stays where the scenario puts it.`,
    ];
  }
  return [
    `This script names no ${attach.from} piece, so the stand-in stays where the scenario puts it rather than sitting on the unit.`,
  ];
}
```

Replace `start` with one that probes, resolves, reports the track and then runs:

```ts
  const start = useCallback(
    async (scenarioId: string) => {
      const scenario = scenarioById(scenarioId);
      if (!scenario) return;

      // No stand-in, no probe and no resolve: most scenarios want neither.
      if (!scenario.standIn && !scenario.events.some((e) => e.aimAtStandIn)) {
        onStandIn({ track: null, attachPieces: new Map() });
        setStandInNotes([]);
        return runEvents(scenario.events, values);
      }

      const pieces = project.pieces.map((piece) => piece.name);
      // A compiled script has no probe: `anim_cob_run` plays bytecode and
      // there is no `anim_cob_probe` beside it. Such a unit gets its stand-in
      // where the keys put it and is told the piece is unknown, which is the
      // same answer a Lua script that names none gets.
      const probes = compiled
        ? null
        : await legoProbeScript({
            script: project.script ?? "",
            unitName: project.unitName,
            pieces,
            callins: STAND_IN_PROBES,
            unitDef: project.gameUnitDef ?? null,
            includes: project.gameScriptIncludes ?? null,
            rest: pieceRest(project),
          });

      const named = new Map<string, string>();
      for (const probe of probes?.probes ?? []) {
        const first = probe.pieces[0];
        if (first) named.set(probe.callin, first);
      }

      const { events, notes } = resolveScenario(scenario, {
        radius: standInRadius(bounds),
        mid: aimPoint(project, bounds),
        pieceRest: pieceWorldRest(project, pack, raw),
        probed: (callin) => named.get(callin) ?? null,
      });

      // What the preview could not work out, said rather than hidden. A script
      // that names no transport piece is exactly the bug this preview exists
      // to expose, so it is not something to fall silent about.
      setStandInNotes([
        ...notes,
        ...attachNotes(scenario, named, compiled !== undefined),
      ]);
      onStandIn({ track: scenario.standIn ?? null, attachPieces: named });
      return runEvents(events, values);
    },
    [runEvents, values, project, compiled, bounds, pack, raw, onStandIn],
  );
```

Hold `standInNotes` in state beside `failure`, and render them with the run's own warnings (`AnimationPanel.tsx:708-712`):

```tsx
          {standInNotes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
```

`stop` clears the track:

```ts
    onStandIn({ track: null, attachPieces: new Map() });
    setStandInNotes([]);
```

Everywhere `start` is voided, keep the existing `void start(...)` form. It already returns a promise.

Add the new props to `Props` and to the destructure:

```ts
  /** The unit's measured box, for sizing the stand-in and for the aim point
   *  the builder's own formula measures from. */
  bounds: UnitBounds;
  /** Both needed to work out where a piece rests, which is where an aim is
   *  measured from. */
  pack: LoadedPack;
  raw: RawGeometry | null;
  /** The track the running scenario puts a stand-in on, and the pieces its
   *  attachments resolved to, for the viewport to place it. */
  onStandIn: (placement: {
    track: StandInTrack | null;
    attachPieces: Map<string, string>;
  }) => void;
```

- [ ] **Step 2: Wire it through `BuilderPage`**

Beside the other playback state (`BuilderPage.tsx:197-207`):

```ts
  /** The stand-in the running scenario asks for, and the pieces it sits on.
   *  Empty whenever nothing is playing or the scenario places none. */
  const [standIn, setStandIn] = useState<{
    track: StandInTrack | null;
    attachPieces: Map<string, string>;
  }>({ track: null, attachPieces: new Map() });
```

Clear it where `setScriptTimeline(null)` already happens at `:703`.

Add a memo beside the existing ones. Measured once per document rather than per consumer, since the panel sizes the stand-in from it:

```ts
  const bounds = useMemo(
    () => unitBounds(draft, loaded, raw),
    [draft, loaded, raw],
  );
```

On `<AnimationPanel>`:

```tsx
                  bounds={bounds}
                  pack={loaded}
                  raw={raw}
                  onStandIn={setStandIn}
```

`loaded` and `raw` above are placeholders. Match whatever names `BuilderPage` actually uses for the pack and the raw geometry.

On `<ModelViewport>`, inside `scriptPlayback`:

```tsx
                  standIn: { ...standIn, show: true },
```

- [ ] **Step 3: Verify it typechecks and the suite is still green**

```bash
bun run typecheck
bun run test
bunx biome ci .
```
Expected: all three clean.

- [ ] **Step 4: Commit**

```bash
git add src/lego/pages/components/AnimationPanel.tsx src/lego/pages/BuilderPage.tsx
git commit -m "Resolve a scenario's stand-in before running it"
```

---

### Task 9: Pick the shape by looking

This is the step the spec reserves for judgement. Do not skip it and do not decide from the code.

**Files:**
- Modify: `src/lego/standIn.ts` (delete the losing candidate)
- Modify: `src/lego/standIn.test.ts` if it named the loser
- Create: two screenshots under `docs/reports/`

- [ ] **Step 1: Prepare a portable instance of your own**

Per `CLAUDE.md`, a fresh portable profile has no games and the app comes up empty.

```bash
bun run tauri build --debug
mkdir -p <app-dir>/.coilbox/data <app-dir>/.coilbox/cache
cp -R "$HOME/Library/Application Support/com.tomjn.coilbox/." <app-dir>/.coilbox/data/
```

Copy rather than point at the real directory. Delete only what you create.

- [ ] **Step 2: Give it its own MCP socket**

`.mcp.json` pins one socket path and the app binds it. If another coilbox already holds that path, your MCP calls drive **that** app with nothing in the response saying so.

Point your build at a socket of your own, and spawn a second MCP server aimed at it rather than repointing this session's:

```bash
node ~/dev/tauri-plugin-mcp/mcp-server-ts/build/index.js --socket /tmp/coilbox-standin.sock
```

Revert the local source edit that moved the socket before committing anything. Confirm which app you are driving before believing a screenshot.

- [ ] **Step 3: Screenshot candidate one**

Open a project with a turret in it, pick the "Aiming and firing" scenario, and play. Pause on a frame where the stand-in is up and to one side. Orbit to a **low rear angle**, which is the case an upside-down sphere fails at: the camera below the stand-in's own middle, looking at its back.

Shrink the window first if the capture comes back black. A black capture means the window is too large, not that the app failed to render.

Save as `docs/reports/stand-in-wedge.png`.

- [ ] **Step 4: Screenshot candidate two**

Set `STAND_IN_SHAPE` to `"glacis"` in `src/lego/standIn.ts`, let vite reload, and take the same shot from the same camera. Save as `docs/reports/stand-in-glacis.png`.

- [ ] **Step 5: Pick, and delete the loser**

Judge on two questions and nothing else:

1. From a low rear angle, can you tell which way it is facing?
2. From that same angle, can you tell which way up it is?

Keep whichever answers both. Delete the other's geometry function, drop the `STAND_IN_SHAPE` constant entirely rather than leaving a one-value union, and inline the winner's call in `buildStandIn`. Leave a comment naming what was compared and why this one won, so nobody re-litigates it from the code alone.

- [ ] **Step 6: Run the tests again**

Run: `bun run test src/lego/standIn.test.ts`
Expected: PASS. The shape tests are about the silhouette rather than the candidate, so they hold for the winner.

- [ ] **Step 7: Commit**

```bash
git add src/lego/standIn.ts src/lego/standIn.test.ts
git commit -m "Keep the stand-in shape that reads from behind and below"
```

`docs/reports/` is gitignored, so the screenshots stay local. Put both in the reply.

---

### Task 10: The whole suite, and drive the five scenarios

- [ ] **Step 1: Run every command CI runs**

A green subset is not a green PR. All seven, in three jobs:

```bash
bunx biome ci .
bun run typecheck
bun run test
scripts/mission-tests.sh
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

`scripts/mission-tests.sh` and two vitest files need `luajit` on PATH. `cargo clippy` compiles the Tauri app crate, so the unitsync sidecar must exist: `bun run sidecar:unitsync`.

Report each command's real exit status. If one fails, say so with its output rather than narrowing the run.

- [ ] **Step 2: Drive all five scenarios on screen**

In the portable instance from Task 9, on a unit whose script is its own, run each of `building`, `building-factory`, `firing`, `transport-load` and `transport-unload`, and confirm by looking:

- The stand-in appears for each, and for none of `moving`, `idle`, `active`, `starting-stopping` or `destroyed`.
- The builder's arm follows the stand-in across as it moves, rather than pointing somewhere fixed.
- The turret turns towards the stand-in on both aims, and pitches differently for the high one and the low one. A turret that turns the wrong way is the sign error the tests assert against, so this is the check that the test is testing the right thing.
- The factory's stand-in sits at the build piece, not at the unit's origin.
- The transport's stand-in approaches, then rides the piece as the script animates it, then comes off and settles.
- A unit whose script names no transport piece shows the note in the panel and leaves the stand-in on its keyed path.
- The toggle in the view controls hides it and brings it back.

A window nobody can see still paints but does not animate: if the user is full screen in another app, `document.visibilityState` is `hidden` and CSS transitions never run. Nothing here is a CSS transition, so screenshots are genuine, but note it if anything looks frozen.

- [ ] **Step 3: Offer to clean up**

Build artefacts fill the disk. Offer to remove the debug build and the portable instance once the PR is up.

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| 1. The stand-in, `src/lego/standIn.ts` | 1, 6 |
| 2. Shape and material, candidates judged by looking | 6, 9 |
| 3. Where it sits, `StandInTrack`, radius from the unit's size | 1, 7 |
| 4. Attachment, piece from the static probe, note when none | 1, 7, 8 |
| 5. Making aim honest, `aimResolver.ts`, sign convention asserted | 3 |
| 6. Scenarios, five of them, Lua argument form | 4, 5 |
| 7. UI, one toggle with the other view controls | 7 |
| 8. Testing, four test files | 1, 2, 3, 4, 6, 7 |

Every spec section has a task. The spec's `standIn.test.ts`, `aimResolver.test.ts`, `scriptPlayback.test.ts` and `ModelViewport.dom.test.tsx` are all covered, plus `s3oBuild.test.ts` and `cobrun_tests.rs`, which the spec did not anticipate needing.

**Out of scope, and stays out:** ground and ship transport, landing pads, particles, a game model as a stand-in, collision, control of the stand-in, projects 2 and 3.

**Known limitations, stated rather than hidden**

- A compiled unit has no probe. `anim_cob_run` exists, and there is no `anim_cob_probe` beside it. Every compiled unit takes the "named no piece" path, which is the spec's own fallback, and the panel says so.
- The probe calls `QueryTransport` with no arguments (`crates/coilbox-springlua/src/unitscript.rs:475`), where the engine passes a unit id. A script that reads its passenger throws, the probe reports the note, and the fallback applies.
- Aim is measured from a piece's rest position, not its animated one. The spec documents why, and the code carries the same comment.
