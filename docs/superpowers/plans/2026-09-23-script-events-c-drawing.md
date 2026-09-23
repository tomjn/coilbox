# Script events, part C: drawing the passenger and marking the scrubber

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The viewport draws the stand-in where the script's attach and drop events put it, riding its piece, hidden in the void or left where it was dropped, and the scrubber carries one mark per frame that has events, each a button that seeks there.

**Architecture:** A pure `passengerAt(events, frame)` in `src/lego/standIn.ts` folds the timeline's attach and drop events into a state. `placeStandIn` consults it ahead of the track. A release point is read once per timeline and drop, by posing the scene on the frame before the drop and reading the piece's group, and is cached so scrubbing stays a pure function of the frame. The marks are a pure `scrubberMarks` and `describeOutput` in `src/lego/scriptMarks.ts`, drawn by a small `ScrubberMarks` component under the slider.

**Tech Stack:** TypeScript, React 19, three.js, the picoframe registry `tooltip`, vitest with happy-dom, bun.

**Spec:** `docs/superpowers/specs/2026-09-23-script-events-design.md`, sections 4 and 5 and testing items 5 and 6. Read it first.

**Depends on:** part A (`2026-09-23-script-events-a-runtimes.md`) merged. This lands before part B. Part B takes the transport scenarios off the probe-based `attach` that this part still draws, and its keys use this part's `fromRelease`.

## Global constraints

- Before any push, run all seven CI commands from the repo root and confirm each passes: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`. `luajit` must be on PATH.
- Do not `git rebase`. Update a branch by merging `origin/main` into it.
- Do not use worktrees. Work in the primary checkout.
- `git add` named files only. Never `git add -A`.
- Filing the PR goes through the `file-pr` skill, and the user approves the description before it is created. Give the user a chance to run `bun tauri dev` first.
- UI uses picoframe components: `Button` from `@picoframe/frame`, and `Tooltip` from `@/components/ui/tooltip`, which is the registry's. No native form controls.
- Interactive elements are at least 24 by 24 CSS pixels and show a `focus-visible` ring.
- Comments match the surrounding code and cite the engine file and line a behaviour comes from.
- Text shown to the user is plain English and sentence case.

## Settled here, beyond the spec

- **`fromRelease` falls back to the track's attach piece before anything has been released.** The transport scenarios still carry a probe `attach` until part B, and `transport-unload`'s keys are measured from it. The fallback keeps that scenario drawing as it does today, and part B removes it with the last `follow: true` attach.
- **The follow and build-spot attach branches in `placeStandIn` stay for a loose stand-in.** Air transports attach in the engine, not in the script, so until part B their runs report no attach events and the probe attach is still what draws them.
- **Only events on `STAND_IN_UNIT_ID` move the drawn stand-in.** An attach on any other id is recorded and changes nothing, as the runtimes treat it.
- **A drop of a stand-in dropped out of the void releases it at the unit's origin**, which is where the void puts a passenger (`rts/Sim/Units/Unit.cpp:726-732`).
- **Explode flag names** come from Balanced Annihilation's `scripts/exptype.h` for bits 1 to 8192, as BOS scripts spell them, and from `rts/Sim/Projectiles/PieceProjectile.h:9-17` for `NOHEATCLOUD` (128) and `RECURSIVE` (16384). `CobDefines.h`, which the spec names, holds the effect numbers but not these flags.
- **An effect number is named the way the engine dispatches it** (`rts/Sim/Units/Scripts/UnitScript.cpp:597-790`): the exact built-ins first, then the first of `SFX_GLOBAL`, `SFX_CEG`, `SFX_FIRE_WEAPON`, `SFX_DETONATE_WEAPON` whose bit is set, less that bit. Weapons are shown counted from one, as a unit definition counts them.
- **Marks merge by pixel only once the row is measured.** Before the first `ResizeObserver` callback the row has no width, and marks merge only when they share a frame.

## Branch

`script-events-drawing`, off `main` once part A has merged.

```bash
git fetch origin
git checkout -b script-events-drawing origin/main
```

---

### Task C1: where the events leave the passenger

**Files:**
- Modify: `src/lego/standIn.ts` (imports at 15-17, new function after `attachedAt` at 125-135)
- Test: `src/lego/standIn.test.ts`

**Interfaces:**
- Consumes: `ScriptOutput`, `STAND_IN_UNIT_ID` from `src/lego/scriptPlayback.ts` (part A).
- Produces:
  ```ts
  export type PassengerState =
    | { kind: "loose" }
    | { kind: "riding"; piece: string }
    | { kind: "void" }
    | { kind: "released"; frame: number; from: string | null };
  export function passengerAt(events: ScriptOutput[], frame: number): PassengerState;
  ```
  `released.from` is the piece it was riding when dropped, or null when it was dropped out of the void.

- [ ] **Step 1: Write the failing tests**

Add `passengerAt` to the import from `./standIn` and `type ScriptOutput` to the import from `./scriptPlayback` in `src/lego/standIn.test.ts`, then append:

```ts
describe("passengerAt", () => {
  const attach = (frame: number, piece: string | null, unit = 2): ScriptOutput => ({
    frame,
    kind: "attach",
    unit,
    piece,
  });
  const drop = (frame: number, unit = 2): ScriptOutput => ({ frame, kind: "drop", unit });

  it("is loose before anything attaches it", () => {
    expect(passengerAt([attach(10, "link")], 9)).toEqual({ kind: "loose" });
    expect(passengerAt([], 100)).toEqual({ kind: "loose" });
  });

  /** `UpdateTransportees` runs within the attach's own frame
   *  (`rts/Game/Game.cpp:1796-1798`), so the picture already has it there. */
  it("rides from the attach's own frame", () => {
    expect(passengerAt([attach(10, "link")], 10)).toEqual({ kind: "riding", piece: "link" });
  });

  it("is in the void when attached to no piece", () => {
    expect(passengerAt([attach(10, "link"), attach(20, null)], 25)).toEqual({ kind: "void" });
  });

  it("remembers the frame and the piece it was let go from", () => {
    const events = [attach(10, "link"), drop(30)];
    expect(passengerAt(events, 29)).toEqual({ kind: "riding", piece: "link" });
    expect(passengerAt(events, 30)).toEqual({ kind: "released", frame: 30, from: "link" });
    expect(passengerAt(events, 99)).toEqual({ kind: "released", frame: 30, from: "link" });
  });

  it("is let go from nowhere when it was dropped out of the void", () => {
    expect(passengerAt([attach(10, null), drop(30)], 30)).toEqual({
      kind: "released",
      frame: 30,
      from: null,
    });
  });

  /** The Hulk picks up, hides, then reaches out and puts down again. */
  it("follows several attach and drop cycles", () => {
    const events = [
      attach(10, "link"),
      attach(40, null),
      drop(60),
      attach(80, "link"),
      drop(120),
    ];
    expect(passengerAt(events, 50)).toEqual({ kind: "void" });
    expect(passengerAt(events, 70)).toEqual({ kind: "released", frame: 60, from: null });
    expect(passengerAt(events, 90)).toEqual({ kind: "riding", piece: "link" });
    expect(passengerAt(events, 130)).toEqual({ kind: "released", frame: 120, from: "link" });
  });

  /** The engine does nothing for an id with no unit behind it, and a drop of a
   *  unit nobody carries does nothing either (`Unit.cpp:2715-2720`). */
  it("ignores other units, and a drop of a stand-in nobody carries", () => {
    expect(passengerAt([attach(10, "link", 7)], 20)).toEqual({ kind: "loose" });
    expect(passengerAt([drop(10)], 20)).toEqual({ kind: "loose" });
  });

  it("ignores effects", () => {
    const events: ScriptOutput[] = [
      attach(10, "link"),
      { frame: 15, kind: "sfx", piece: "flare", sfx: 1025 },
    ];
    expect(passengerAt(events, 20)).toEqual({ kind: "riding", piece: "link" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/standIn.test.ts`
Expected: FAIL, `passengerAt` is not exported.

- [ ] **Step 3: Write `passengerAt`**

Change the import at line 17 of `src/lego/standIn.ts` to:

```ts
import {
  type ScriptOutput,
  STAND_IN_UNIT_ID,
  type StandInAttach,
  type StandInKey,
  type StandInTrack,
} from "./scriptPlayback";
```

After `attachedAt`:

```ts
/** Where the script's own attach and drop events leave the stand-in on a frame. */
export type PassengerState =
  | { kind: "loose" }
  | { kind: "riding"; piece: string }
  | { kind: "void" }
  /** `from` is the piece it rode until it was let go, or null out of the void. */
  | { kind: "released"; frame: number; from: string | null };

/**
 * Fold a run's attach and drop events up to `frame` into where they leave the
 * stand-in.
 *
 * An event on its own frame counts, because the engine moves a passenger within
 * the frame it was attached (`rts/Game/Game.cpp:1796-1798`). Events about any
 * other unit id change nothing, and neither does a drop of a stand-in nobody is
 * carrying (`rts/Sim/Units/Unit.cpp:2715-2720`).
 */
export function passengerAt(events: ScriptOutput[], frame: number): PassengerState {
  let state: PassengerState = { kind: "loose" };
  for (const event of events) {
    if (event.frame > frame) break;
    if (event.kind !== "attach" && event.kind !== "drop") continue;
    if (event.unit !== STAND_IN_UNIT_ID) continue;
    if (event.kind === "attach") {
      state =
        event.piece === null
          ? { kind: "void" }
          : { kind: "riding", piece: event.piece };
    } else if (state.kind === "riding" || state.kind === "void") {
      state = {
        kind: "released",
        frame: event.frame,
        from: state.kind === "riding" ? state.piece : null,
      };
    }
  }
  return state;
}
```

The runtimes push events as they happen, so `events` is already in frame order, which is what the early `break` relies on.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/lego/standIn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lego/standIn.ts src/lego/standIn.test.ts
git commit -m "Work out where a script's attach and drop events leave the stand-in"
```

---

### Task C2: keys after a release

**Files:**
- Modify: `src/lego/scriptPlayback.ts:117-135` (`StandInKey`), `:503-511` (`transport-unload` keys)
- Modify: `src/lego/standIn.ts:59-119` (`StandInPose`, `standInAt`, `posed`), new function after `passengerAt`
- Modify: `src/lego/aimResolver.ts:187-225` (`worldAt`)
- Modify, renames in tests: `src/lego/scriptPlayback.test.ts:185-186`, `src/lego/aimResolver.test.ts:232-247`, `src/lego/pages/components/ModelViewport.dom.test.tsx:512-537`
- Test: `src/lego/standIn.test.ts`

**Interfaces:**
- Produces:
  - `StandInKey.fromRelease?: boolean`, replacing `fromAttachPiece`.
  - `StandInPose.fromRelease: boolean`, replacing `fromAttachPiece`.
  - `export function standInAfterRelease(track: StandInTrack, frame: number, release: { frame: number; at: Vec3 }, radius: number): { pos: Vec3; heading: number }`, positions in elmos.

- [ ] **Step 1: Rename, and let the typecheck find every use**

In `scriptPlayback.ts`, replace the `fromAttachPiece` field and its comment in `StandInKey` with:

```ts
  /**
   * Measure `pos` from where the stand-in was last let go, rather than from the
   * unit's origin.
   *
   * What a dropped passenger needs: it moves off from where the transport put
   * it down. Until something has let it go, the track's attach piece stands in
   * for that point, which is what a track is measured from before a run has
   * said where anything was dropped.
   */
  fromRelease?: boolean;
```

Run: `bun run typecheck`
Expected: errors at every `fromAttachPiece`. Rename each to `fromRelease`: `standIn.ts` (`StandInPose` and its doc comment, `standInAt`, `posed`), `aimResolver.ts` `worldAt`, `standInPlayback.ts:81`, the four `transport-unload` keys, and the three test files listed above. In the `ModelViewport.dom.test.tsx` test at 512, rename the test to `"measures a fromRelease key from the attach piece before anything is let go"`. Behaviour does not change in this step. Run `bun run typecheck && bunx vitest run src/lego` and expect a pass before going on.

- [ ] **Step 2: Write the failing tests for `standInAfterRelease`**

Append to `src/lego/standIn.test.ts`, adding `standInAfterRelease` to the import:

```ts
describe("standInAfterRelease", () => {
  const release = { frame: 100, at: [5, 4, 0] as [number, number, number] };

  /** A dropped stand-in holds where it was let go and does not fall. */
  it("holds at the release point when no key follows it", () => {
    const pose = standInAfterRelease({ keys: [{ frame: 0, pos: [0, 0, 9] }] }, 150, release, 10);
    expect(pose).toEqual({ pos: [5, 4, 0], heading: 0 });
  });

  /** The release point is an implicit key on the drop's frame. */
  it("moves from the release point to the next key", () => {
    const pose = standInAfterRelease(
      { keys: [{ frame: 200, pos: [0, 0, 1] }] },
      150,
      release,
      10,
    );
    expect(pose.pos).toEqual([2.5, 2, 5]);
  });

  it("measures a fromRelease key from the release point", () => {
    const pose = standInAfterRelease(
      { keys: [{ frame: 200, pos: [0, 1, 0], fromRelease: true }] },
      200,
      release,
      10,
    );
    expect(pose.pos).toEqual([5, 14, 0]);
  });

  /** The runtime owned the stand-in while it was carried. */
  it("passes over keys at or before the drop", () => {
    const pose = standInAfterRelease(
      {
        keys: [
          { frame: 50, pos: [9, 9, 9] },
          { frame: 100, pos: [9, 9, 9] },
        ],
      },
      120,
      release,
      10,
    );
    expect(pose.pos).toEqual([5, 4, 0]);
  });

  it("is at the release point on the drop's own frame", () => {
    const pose = standInAfterRelease(
      { keys: [{ frame: 200, pos: [0, 0, 1] }] },
      100,
      release,
      10,
    );
    expect(pose.pos).toEqual([5, 4, 0]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/standIn.test.ts`
Expected: FAIL, `standInAfterRelease` is not exported.

- [ ] **Step 4: Write `standInAfterRelease`**

After `passengerAt` in `src/lego/standIn.ts`:

```ts
/**
 * Where a track puts the stand-in after it was let go, in elmos.
 *
 * The release point is an implicit key on the drop's frame, and keys after it
 * interpolate from there. Keys at or before the drop are passed over, because
 * the runtime owned the stand-in while it was carried. A `fromRelease` key is
 * measured from the release point. The implicit key faces the way the unit
 * does, because a carried unit takes its transporter's heading
 * (`rts/Sim/Units/Unit.cpp:734-748`), which is 0 in the editor.
 *
 * A stand-in let go holds where it was put down and does not fall. Falling
 * belongs to the move type, which the preview does not have.
 *
 * Known gap, recorded rather than designed for: a return leg keyed after a drop
 * walks the stand-in back while the runtime still answers the release point,
 * because no call-in fires during a return leg.
 */
export function standInAfterRelease(
  track: StandInTrack,
  frame: number,
  release: { frame: number; at: Vec3 },
  radius: number,
): { pos: Vec3; heading: number } {
  const place = (key: StandInKey): Vec3 => {
    const from = key.fromRelease ? release.at : [0, 0, 0];
    return [
      from[0] + key.pos[0] * radius,
      from[1] + key.pos[1] * radius,
      from[2] + key.pos[2] * radius,
    ];
  };
  let from = { frame: release.frame, pos: release.at, heading: 0 };
  for (const key of track.keys) {
    if (key.frame <= release.frame) continue;
    const to = { frame: key.frame, pos: place(key), heading: key.heading ?? 0 };
    if (frame <= to.frame) {
      const span = to.frame - from.frame;
      const t = span === 0 ? 1 : (frame - from.frame) / span;
      return {
        pos: [
          mix(from.pos[0], to.pos[0], t),
          mix(from.pos[1], to.pos[1], t),
          mix(from.pos[2], to.pos[2], t),
        ],
        heading: mix(from.heading, to.heading, t),
      };
    }
    from = to;
  }
  return { pos: from.pos, heading: from.heading };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bunx vitest run src/lego/standIn.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lego/scriptPlayback.ts src/lego/scriptPlayback.test.ts src/lego/standIn.ts src/lego/standIn.test.ts src/lego/aimResolver.ts src/lego/aimResolver.test.ts src/lego/pages/components/standInPlayback.ts src/lego/pages/components/ModelViewport.dom.test.tsx
git commit -m "Measure keys after a drop from where the stand-in was let go"
```

---

### Task C3: draw the stand-in from the events

**Files:**
- Modify: `src/lego/pages/components/standInPlayback.ts` (whole file, 122 lines)
- Modify: `src/lego/pages/components/useScriptFrameStepping.ts:104-109,165`
- Test: `src/lego/pages/components/ModelViewport.dom.test.tsx`, `describe("placeStandIn")` at 359

**Interfaces:**
- Consumes: `passengerAt`, `standInAfterRelease` (C1, C2), `applyTimelineFrame(state, project, timeline, frame)` from `./animationPlayback`.
- Produces: `placeStandIn(state: SceneState, project: LegoProject, placement: StandInPlacement, timeline: ScriptTimeline | null, frame: number): void`. The new fourth argument is the timeline being played, or null.

- [ ] **Step 1: Update the existing calls, then write the failing tests**

Every existing `placeStandIn(state, doc, {...}, 0)` in `ModelViewport.dom.test.tsx` becomes `placeStandIn(state, doc, {...}, null, 0)`.

Add `import type { ScriptOutput, ScriptTimeline } from "../../scriptPlayback";` and, inside `describe("placeStandIn")`:

```ts
  /** A run of `frames` frames over `base` and `arm`, with the arm moved along x
   *  by `armX(frame)` and nothing else moving. */
  function run(
    frames: number,
    armX: (frame: number) => number,
    events: ScriptOutput[],
  ): ScriptTimeline {
    return {
      fps: 30,
      pieces: ["base", "arm"],
      frames: Array.from({ length: frames }, (_, f) => [
        0, 0, 0, 0, 0, 0,
        armX(f), 0, 0, 0, 0, 0,
      ]),
      hidden: [],
      error: null,
      warnings: [],
      asked: [],
      functions: [],
      linesRun: [],
      offsetsRun: [],
      events,
    };
  }

  const held = { track: { keys: [{ frame: 0, pos: [9, 0, 9] as [number, number, number] }] }, attachPieces: new Map(), show: true };

  /** The track says one place and the script says another. The script wins. */
  it("rides the piece its script attached it to, from the attach's own frame", () => {
    const state = standInScene();
    state.groups.get("base")?.position.set(3, 0, 0);
    state.groups.get("arm")?.position.set(0, 7, 0);
    const timeline = run(4, () => 0, [{ frame: 2, kind: "attach", unit: 2, piece: "arm" }]);

    placeStandIn(state, doc, held, timeline, 2);

    expect(state.standIn.visible).toBe(true);
    expect(state.standIn.position.toArray()).toEqual([3, 7, 0]);
    expect(state.standIn.rotation.y).toBe(0);
  });

  /** `rts/Rendering/Units/UnitDrawer.cpp:418` draws nothing in the void. */
  it("hides it in the void", () => {
    const state = standInScene();
    const timeline = run(4, () => 0, [{ frame: 1, kind: "attach", unit: 2, piece: null }]);

    placeStandIn(state, doc, held, timeline, 2);

    expect(state.standIn.visible).toBe(false);
  });

  /** Let go where the piece was on the frame before the drop, which is the
   *  last place the engine put it (`rts/Sim/Units/Unit.cpp:718-757`). */
  it("leaves it where the piece was the frame before the drop", () => {
    const state = standInScene();
    const timeline = run(6, (f) => (f === 0 ? 0 : f === 1 ? 5 : 9), [
      { frame: 0, kind: "attach", unit: 2, piece: "arm" },
      { frame: 2, kind: "drop", unit: 2 },
    ]);
    applyTimelineFrame(state, doc, timeline, 4);

    placeStandIn(state, doc, held, timeline, 4);

    // The arm rests at y 4 and was 5 along x on frame 1.
    expect(state.standIn.position.toArray()).toEqual([5, 4, 0]);
    // Posed back to the frame being drawn.
    expect(state.groups.get("arm")?.position.toArray()).toEqual([9, 4, 0]);
  });

  /** Scrubbing back and forth gives the same picture each time. */
  it("gives the same release point however it is reached", () => {
    const state = standInScene();
    const timeline = run(6, (f) => f, [
      { frame: 0, kind: "attach", unit: 2, piece: "arm" },
      { frame: 3, kind: "drop", unit: 2 },
    ]);
    applyTimelineFrame(state, doc, timeline, 5);
    placeStandIn(state, doc, held, timeline, 5);
    const first = state.standIn.position.toArray();
    applyTimelineFrame(state, doc, timeline, 1);
    placeStandIn(state, doc, held, timeline, 1);
    applyTimelineFrame(state, doc, timeline, 5);
    placeStandIn(state, doc, held, timeline, 5);

    expect(state.standIn.position.toArray()).toEqual(first);
    expect(first).toEqual([2, 4, 0]);
  });

  it("follows the track from the release point once it is let go", () => {
    const state = standInScene();
    const timeline = run(20, () => 0, [
      { frame: 0, kind: "attach", unit: 2, piece: "arm" },
      { frame: 2, kind: "drop", unit: 2 },
    ]);
    const track = {
      keys: [
        { frame: 0, pos: [9, 9, 9] as [number, number, number] },
        { frame: 12, pos: [0, 1, 0] as [number, number, number], fromRelease: true },
      ],
    };

    placeStandIn(state, doc, { track, attachPieces: new Map(), show: true }, timeline, 7);

    // Halfway from (0, 4, 0) to ten elmos above it.
    expect(state.standIn.position.toArray()).toEqual([0, 9, 0]);
  });
```

Add `import { applyTimelineFrame } from "./animationPlayback";` to the test's imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/pages/components/ModelViewport.dom.test.tsx`
Expected: the five new tests FAIL, the existing ones pass with the added `null`.

- [ ] **Step 3: Rewrite `standInPlayback.ts`**

```ts
/**
 * Put the stand-in where the running script and the scenario's track say it is
 * on one frame.
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
import type { ScriptTimeline, StandInTrack } from "../../scriptPlayback";
import {
  attachedAt,
  type PassengerState,
  passengerAt,
  standInAfterRelease,
  standInAt,
} from "../../standIn";
import { applyTimelineFrame } from "./animationPlayback";
import type { SceneState } from "./sceneState";

type Vec3 = [number, number, number];

export interface StandInPlacement {
  /** The running scenario's track, or null when it defines none. */
  track: StandInTrack | null;
  /** The piece each attach source named, keyed by the call-in it came from.
   *  A source the probe answered nothing for is simply absent. */
  attachPieces: Map<string, string>;
  /** The viewport's own toggle. */
  show: boolean;
}

const AT = new THREE.Vector3();
const LOOSE: PassengerState = { kind: "loose" };

export function placeStandIn(
  state: SceneState,
  project: LegoProject,
  { track, attachPieces, show }: StandInPlacement,
  timeline: ScriptTimeline | null,
  frame: number,
): void {
  if (!show || !track) {
    state.standIn.visible = false;
    return;
  }

  // From its first attach the script owns where the stand-in is, so its events
  // come ahead of the track.
  const passenger = timeline ? passengerAt(timeline.events, frame) : LOOSE;
  if (passenger.kind === "void") {
    state.standIn.visible = false;
    return;
  }
  if (passenger.kind === "riding") {
    const group = groupOfPiece(state, project, passenger.piece);
    if (group) {
      // The pose was written onto the groups a moment ago and nothing has
      // rendered since, so their world matrices are a frame out until this
      // asks for them. Drawn from the three.js hierarchy, which composes
      // rotations, so a stand-in on a turned boom is where the boom is.
      group.updateWorldMatrix(true, false);
      state.standIn.visible = true;
      state.standIn.rotation.set(0, 0, 0);
      state.standIn.position.copy(group.getWorldPosition(AT));
      return;
    }
  }
  if (passenger.kind === "released" && timeline) {
    const at = releasePoint(state, project, timeline, passenger, frame);
    const pose = standInAfterRelease(
      track,
      frame,
      { frame: passenger.frame, at },
      state.standInRadius,
    );
    state.standIn.visible = true;
    state.standIn.rotation.set(0, pose.heading, 0);
    state.standIn.position.set(...pose.pos);
    return;
  }

  placeLoose(state, project, track, attachPieces, frame);
}

/** Before anything has attached it, the track, as it always was. */
function placeLoose(
  state: SceneState,
  project: LegoProject,
  track: StandInTrack,
  attachPieces: Map<string, string>,
  frame: number,
): void {
  const pose = standInAt(track, frame, state.standInRadius);
  if (!pose) {
    state.standIn.visible = false;
    return;
  }
  state.standIn.visible = true;
  state.standIn.rotation.set(0, pose.heading, 0);

  // The track's own attach piece rather than the one in force on this frame:
  // a key measured from it is measured from it after the detachment too.
  const piece = track.attach ? attachPieces.get(track.attach.from) : undefined;
  const group = piece ? groupOfPiece(state, project, piece) : undefined;
  const attach = attachedAt(track, frame);
  group?.updateWorldMatrix(true, false);

  // Riding a piece the probe named: the stand-in takes that piece's position
  // outright. Its own keyed position says nothing while it is being carried.
  if (attach?.follow && group) {
    state.standIn.position.copy(group.getWorldPosition(AT));
    return;
  }

  // Sitting where a piece rests rather than riding it: a factory's build spot.
  // The rest offsets are what `showBaked` wrote, so this is the piece's place
  // before anything animated it.
  if (attach && !attach.follow && piece) {
    const rest = restOfPiece(state, project, piece);
    if (rest) {
      state.standIn.position.set(...rest);
      return;
    }
  }

  // Loose, or attached to a piece the probe never named. Nothing has been let
  // go yet, so a `fromRelease` key is measured from the attach piece. With no
  // piece to measure from it falls back to the unit's origin, which is the
  // same answer an ordinary key gives.
  AT.set(0, 0, 0);
  if (pose.fromRelease && group) group.getWorldPosition(AT);
  state.standIn.position.set(
    AT.x + pose.pos[0],
    AT.y + pose.pos[1],
    AT.z + pose.pos[2],
  );
}

/** Release points already read, per timeline and drop frame, so scrubbing
 *  stays a pure function of the frame. A new run is a new timeline. */
const RELEASES = new WeakMap<ScriptTimeline, Map<number, Vec3>>();

/**
 * Where a dropped stand-in was let go: its piece's world position on the frame
 * before the drop, which is the last place `UpdateTransportees` put it
 * (`rts/Sim/Units/Unit.cpp:718-757`). The unit's own origin for one dropped out
 * of the void (`Unit.cpp:726-732`).
 *
 * Read by posing the scene on that frame and asking the group, so a piece on a
 * turned boom is where it is, then posing the scene back to `frame`.
 */
function releasePoint(
  state: SceneState,
  project: LegoProject,
  timeline: ScriptTimeline,
  released: { frame: number; from: string | null },
  frame: number,
): Vec3 {
  let known = RELEASES.get(timeline);
  if (!known) {
    known = new Map();
    RELEASES.set(timeline, known);
  }
  const cached = known.get(released.frame);
  if (cached) return cached;

  let at: Vec3 = [0, 0, 0];
  const group = released.from
    ? groupOfPiece(state, project, released.from)
    : undefined;
  if (group) {
    applyTimelineFrame(state, project, timeline, Math.max(released.frame - 1, 0));
    group.updateWorldMatrix(true, false);
    group.getWorldPosition(AT);
    at = [AT.x, AT.y, AT.z];
    applyTimelineFrame(state, project, timeline, frame);
  }
  known.set(released.frame, at);
  return at;
}
```

Keep `groupOfPiece` and `restOfPiece` exactly as they are, at the end of the file.

- [ ] **Step 4: Pass the timeline from the frame stepping**

In `useScriptFrameStepping.ts`, the tick's call at 104-109 becomes:

```ts
          placeStandIn(
            state,
            projectRef.current,
            standInRef.current,
            timeline,
            frameAt(timeline, elapsed),
          );
```

and the scrub effect's call at 165 becomes `placeStandIn(state, projectRef.current, standIn, scriptTimeline, frame);`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run typecheck && bunx vitest run src/lego`
Expected: no type errors, all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lego/pages/components/standInPlayback.ts src/lego/pages/components/useScriptFrameStepping.ts src/lego/pages/components/ModelViewport.dom.test.tsx
git commit -m "Draw the stand-in where the script attached, hid or dropped it"
```

---

### Task C4: what a mark says

**Files:**
- Create: `src/lego/scriptMarks.ts`
- Test: `src/lego/scriptMarks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ScrubberMark { frame: number; events: ScriptOutput[] }
  export function scrubberMarks(events: ScriptOutput[], frameCount: number, width: number): ScrubberMark[];
  export function markPercent(frame: number, frameCount: number): number;
  export function markLabel(mark: ScrubberMark): string;
  export function describeOutput(event: ScriptOutput): string;
  export function sfxName(sfx: number): string;
  export function explodeFlags(flags: number): string;
  ```

- [ ] **Step 1: Write the failing tests**

`src/lego/scriptMarks.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { ScriptOutput } from "./scriptPlayback";
import {
  describeOutput,
  explodeFlags,
  markLabel,
  markPercent,
  scrubberMarks,
  sfxName,
} from "./scriptMarks";

describe("describeOutput", () => {
  it("names each kind the way the spec lists them", () => {
    expect(describeOutput({ frame: 0, kind: "sfx", piece: "flare", sfx: 1025 })).toBe(
      "EmitSfx 1025 from flare (CEG 1)",
    );
    expect(describeOutput({ frame: 0, kind: "explode", piece: "arm1", flags: 257 })).toBe(
      "Explode arm1 (SHATTER | BITMAP1)",
    );
    expect(describeOutput({ frame: 0, kind: "sound", name: "krogtaunt" })).toBe("Sound krogtaunt");
    expect(describeOutput({ frame: 0, kind: "attach", unit: 2, piece: "link" })).toBe(
      "Attach stand-in to link",
    );
    expect(describeOutput({ frame: 0, kind: "attach", unit: 2, piece: null })).toBe(
      "Attach stand-in to the void",
    );
    expect(describeOutput({ frame: 0, kind: "drop", unit: 2 })).toBe("Drop stand-in");
  });

  it("says a unit that is not the stand-in by its id", () => {
    expect(describeOutput({ frame: 0, kind: "drop", unit: 7 })).toBe("Drop unit 7");
  });

  it("says a sound a TA script played has no name", () => {
    expect(describeOutput({ frame: 0, kind: "sound", name: null })).toBe(
      "Sound, which a TA script does not name",
    );
  });
});

/** `rts/Sim/Units/Scripts/UnitScript.cpp:597-790`, in its order. */
describe("sfxName", () => {
  it("names the built-in effects exactly", () => {
    expect(sfxName(0)).toBe("VTOL");
    expect(sfxName(3)).toBe("wake");
    expect(sfxName(257)).toBe("white smoke");
  });

  it("takes the first range bit the engine checks", () => {
    expect(sfxName(16384 + 3)).toBe("global CEG 3");
    expect(sfxName(1024)).toBe("CEG 0");
    expect(sfxName(2048)).toBe("fires weapon 1");
    expect(sfxName(4096 + 1)).toBe("detonates weapon 2");
  });

  it("says when a number is none of them", () => {
    expect(sfxName(7)).toBe("not an effect the engine knows");
  });
});

describe("explodeFlags", () => {
  it("names every bit it knows and gives the rest as a number", () => {
    expect(explodeFlags(1 | 8 | 16384)).toBe("SHATTER | SMOKE | RECURSIVE");
    expect(explodeFlags(1 | 65536)).toBe("SHATTER | 65536");
    expect(explodeFlags(0)).toBe("no flags");
  });
});

describe("scrubberMarks", () => {
  const at = (frame: number): ScriptOutput => ({ frame, kind: "drop", unit: 2 });

  it("makes one mark per frame when nothing is measured yet", () => {
    const marks = scrubberMarks([at(1), at(1), at(2)], 450, 0);
    expect(marks.map((m) => [m.frame, m.events.length])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  /** 1000 frames across 50 pixels is 20 frames to a pixel. */
  it("merges frames that fall on the same pixel", () => {
    const marks = scrubberMarks([at(500), at(501), at(900)], 1000, 50);
    expect(marks.map((m) => [m.frame, m.events.length])).toEqual([
      [500, 2],
      [900, 1],
    ]);
  });

  it("places a mark along the scrubber as a percentage", () => {
    expect(markPercent(0, 451)).toBe(0);
    expect(markPercent(450, 451)).toBe(100);
    expect(markPercent(0, 1)).toBe(0);
  });

  it("labels a mark by its frame, counted from one, and what happened first", () => {
    expect(markLabel({ frame: 9, events: [at(9)] })).toBe("Frame 10: Drop stand-in");
    expect(markLabel({ frame: 9, events: [at(9), at(9), at(10)] })).toBe(
      "Frame 10: Drop stand-in, and 2 more",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/scriptMarks.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `scriptMarks.ts`**

```ts
/**
 * The marks under the script scrubber: one per frame on which the script
 * announced something, and the words each one says.
 *
 * What a script announces is recorded by the runtime and drawn by nothing yet.
 * A mark is where to look for it.
 */

import { type ScriptOutput, STAND_IN_UNIT_ID } from "./scriptPlayback";

/** Every event on frames that land on the same pixel of the scrubber, and the
 *  frame a click on the mark seeks to, which is the first of them. */
export interface ScrubberMark {
  frame: number;
  events: ScriptOutput[];
}

/** How far along the scrubber a frame is, from 0 to 100. */
export function markPercent(frame: number, frameCount: number): number {
  return frameCount <= 1 ? 0 : (frame / (frameCount - 1)) * 100;
}

/**
 * Group a run's events into marks.
 *
 * Frames that land on the same pixel of a scrubber `width` pixels wide become
 * one mark, so a burst of effects is one thing to point at rather than a smear.
 * Before the row has been measured its width is 0, and marks merge only when
 * they share a frame.
 */
export function scrubberMarks(
  events: ScriptOutput[],
  frameCount: number,
  width: number,
): ScrubberMark[] {
  const marks: ScrubberMark[] = [];
  let lastPixel: number | null = null;
  for (const event of events) {
    const pixel =
      width > 0
        ? Math.round((markPercent(event.frame, frameCount) / 100) * width)
        : event.frame;
    const last = marks[marks.length - 1];
    if (last && pixel === lastPixel) {
      last.events.push(event);
    } else {
      marks.push({ frame: event.frame, events: [event] });
      lastPixel = pixel;
    }
  }
  return marks;
}

/** What a mark's button is called: its frame, counted from one as the frame
 *  counter beside the scrubber counts, and the first thing that happened. */
export function markLabel(mark: ScrubberMark): string {
  const more = mark.events.length - 1;
  const first = describeOutput(mark.events[0]);
  return `Frame ${mark.frame + 1}: ${first}${more > 0 ? `, and ${more} more` : ""}`;
}

function unitName(unit: number): string {
  return unit === STAND_IN_UNIT_ID ? "stand-in" : `unit ${unit}`;
}

export function describeOutput(event: ScriptOutput): string {
  switch (event.kind) {
    case "sfx":
      return `EmitSfx ${event.sfx} from ${event.piece} (${sfxName(event.sfx)})`;
    case "explode":
      return `Explode ${event.piece} (${explodeFlags(event.flags)})`;
    case "sound":
      return event.name === null
        ? "Sound, which a TA script does not name"
        : `Sound ${event.name}`;
    case "attach":
      return event.piece === null
        ? `Attach ${unitName(event.unit)} to the void`
        : `Attach ${unitName(event.unit)} to ${event.piece}`;
    case "drop":
      return `Drop ${unitName(event.unit)}`;
  }
}

/** The built-in effects, by the number `rts/Sim/Units/Scripts/CobDefines.h:9-16`
 *  gives them. */
const BUILT_IN_SFX: Record<number, string> = {
  0: "VTOL",
  2: "wake",
  3: "wake",
  4: "reverse wake",
  5: "reverse wake",
  257: "white smoke",
  258: "black smoke",
  259: "bubbles",
};

/** The range bits, in the order `CUnitScript::EmitSfx` tests them
 *  (`UnitScript.cpp:597-790`), each with what it means. */
const SFX_RANGES: [number, (index: number) => string][] = [
  [16384, (index) => `global CEG ${index}`],
  [1024, (index) => `CEG ${index}`],
  // A unit definition counts its weapons from one.
  [2048, (index) => `fires weapon ${index + 1}`],
  [4096, (index) => `detonates weapon ${index + 1}`],
];

/** An effect number in words, as the engine would read it. */
export function sfxName(sfx: number): string {
  const builtIn = BUILT_IN_SFX[sfx];
  if (builtIn) return builtIn;
  for (const [bit, name] of SFX_RANGES) {
    if ((sfx & bit) !== 0) return name(sfx - bit);
  }
  return "not an effect the engine knows";
}

/**
 * Explode's flags, by the names BOS scripts use in Balanced Annihilation's
 * `scripts/exptype.h`, plus the two only the engine names
 * (`rts/Sim/Projectiles/PieceProjectile.h:9-17`).
 */
const EXPLODE_FLAGS: [number, string][] = [
  [1, "SHATTER"],
  [2, "EXPLODE_ON_HIT"],
  [4, "FALL"],
  [8, "SMOKE"],
  [16, "FIRE"],
  [32, "BITMAPONLY"],
  [64, "NOCEGTRAIL"],
  [128, "NOHEATCLOUD"],
  [256, "BITMAP1"],
  [512, "BITMAP2"],
  [1024, "BITMAP3"],
  [2048, "BITMAP4"],
  [4096, "BITMAP5"],
  [8192, "BITMAPNUKE"],
  [16384, "RECURSIVE"],
];

export function explodeFlags(flags: number): string {
  const names: string[] = [];
  let rest = flags;
  for (const [bit, name] of EXPLODE_FLAGS) {
    if ((flags & bit) !== 0) {
      names.push(name);
      rest &= ~bit;
    }
  }
  if (rest !== 0) names.push(String(rest));
  return names.length > 0 ? names.join(" | ") : "no flags";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/lego/scriptMarks.test.ts && bunx biome ci src/lego/scriptMarks.ts src/lego/scriptMarks.test.ts`
Expected: PASS, and biome clean. If biome rejects the bitwise operators, read which rule it names before changing anything, and check how other files in `src/` satisfy it.

- [ ] **Step 5: Commit**

```bash
git add src/lego/scriptMarks.ts src/lego/scriptMarks.test.ts
git commit -m "Say in words what a script announced"
```

---

### Task C5: the marks under the scrubber

**Files:**
- Create: `src/lego/pages/components/ScrubberMarks.tsx`
- Modify: `src/lego/pages/components/AnimationPanel.tsx:620-656` (the scrubber row)
- Test: `src/lego/pages/components/AnimationPanel.dom.test.tsx` (the `show` helper at 91-112 and a new `describe`)

**Interfaces:**
- Consumes: `scrubberMarks`, `markPercent`, `markLabel`, `describeOutput` (C4).
- Produces: `export function ScrubberMarks(props: { events: ScriptOutput[]; frameCount: number; onSeek: (frame: number) => void }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

In `AnimationPanel.dom.test.tsx`, let `show` take overrides:

```tsx
function show(
  value: LegoProject,
  over: Partial<React.ComponentProps<typeof AnimationPanel>> = {},
) {
  return render(
    <AnimationPanel
      project={value}
      /* ...every existing prop unchanged... */
      onStandIn={vi.fn()}
      {...over}
    />,
  );
}
```

Add `import type * as React from "react";` if the file does not already import React's types, and `import type { ScriptOutput } from "../../scriptPlayback";` beside the `ScriptTimeline` import.

Then add:

```tsx
/** happy-dom's ResizeObserver never calls back, so a test that needs the row
 *  measured brings its own, firing once with a fixed width. The same pattern as
 *  `src/workshop/pages/components/UnitList.dom.test.tsx`. */
class FixedWidthResizeObserver {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe() {
    this.#callback(
      [{ contentRect: { width: 50 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

describe("marks under the scrubber", () => {
  const frames = (count: number) =>
    Array.from({ length: count }, () => [0, 0, 0, 0, 0, 0]);

  async function played(events: ScriptOutput[], count = 100, over = {}) {
    runCob.mockResolvedValue(timeline({ frames: frames(count), events }));
    show(project({ compiledScript: COMPILED }), over);
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    // The frame counter beside the scrubber, which only renders once the run
    // came back with frames to play.
    await waitFor(() => expect(screen.getByText(`1/${count}`)).toBeTruthy());
  }

  it("marks nothing for a run that announced nothing", async () => {
    await played([]);
    expect(screen.queryByRole("group", { name: /What the script announced/ })).toBeNull();
  });

  it("marks each frame that has events, named for what happened", async () => {
    await played([
      { frame: 10, kind: "attach", unit: 2, piece: "link" },
      { frame: 40, kind: "sfx", piece: "flare", sfx: 1025 },
    ]);
    expect(screen.getByRole("button", { name: "Frame 11: Attach stand-in to link" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Frame 41: EmitSfx 1025 from flare (CEG 1)" }),
    ).toBeTruthy();
  });

  it("seeks to a mark's frame, pausing first", async () => {
    const onScriptFrameChange = vi.fn();
    const onScriptPausedChange = vi.fn();
    await played([{ frame: 10, kind: "drop", unit: 2 }], 100, {
      onScriptFrameChange,
      onScriptPausedChange,
    });
    onScriptFrameChange.mockClear();
    onScriptPausedChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Frame 11/ }));

    expect(onScriptPausedChange).toHaveBeenCalledWith(true);
    expect(onScriptFrameChange).toHaveBeenCalledWith(10);
  });

  it("merges frames that fall on the same pixel", async () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = FixedWidthResizeObserver as unknown as typeof ResizeObserver;
    try {
      await played(
        [
          { frame: 500, kind: "drop", unit: 2 },
          { frame: 501, kind: "sfx", piece: "flare", sfx: 1024 },
        ],
        1000,
      );
      expect(screen.getByRole("button", { name: "Frame 501: Drop stand-in, and 1 more" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Frame 502/ })).toBeNull();
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});
```

The `timeline()` helper at line 49 already spreads `over`, so `events` passes through once part A has added it to the defaults.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/lego/pages/components/AnimationPanel.dom.test.tsx`
Expected: "marks nothing" passes, the other three FAIL on the missing buttons.

- [ ] **Step 3: Write `ScrubberMarks.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  describeOutput,
  markLabel,
  markPercent,
  scrubberMarks,
} from "../../scriptMarks";
import type { ScriptOutput } from "../../scriptPlayback";

/**
 * One mark under the scrubber for each frame the script announced something
 * on: an effect, an explosion, a sound, or carrying the stand-in. Each is a
 * button that seeks to its frame, and its tooltip lists what happened there.
 *
 * Measured, so that frames too close to tell apart on screen share a mark.
 */
export function ScrubberMarks({
  events,
  frameCount,
  onSeek,
}: {
  events: ScriptOutput[];
  frameCount: number;
  onSeek: (frame: number) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const marks = scrubberMarks(events, frameCount, width);
  return (
    <TooltipProvider>
      <div
        ref={row}
        role="group"
        aria-label="What the script announced"
        className="relative h-6"
      >
        {marks.map((mark) => (
          <Tooltip key={mark.frame}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={markLabel(mark)}
                onClick={() => onSeek(mark.frame)}
                className="absolute top-0 flex size-6 -translate-x-1/2 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: `${markPercent(mark.frame, frameCount)}%` }}
              >
                <span className="block h-3 w-0.5 rounded-full bg-primary" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <ul className="flex flex-col gap-0.5 text-xs">
                {mark.events.map((event, index) => (
                  <li key={`${event.frame}-${index}`}>
                    Frame {event.frame + 1}: {describeOutput(event)}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 4: Put it under the slider**

In `AnimationPanel.tsx`, import `ScrubberMarks` from `./ScrubberMarks`, and replace the `<Slider ... />` element at 631-642 with a column holding the slider and the marks:

```tsx
            <div className="flex flex-1 flex-col gap-1">
              <Slider
                min={0}
                max={Math.max((timeline?.frames.length ?? 1) - 1, 0)}
                step={1}
                value={[scriptFrame]}
                onValueChange={([next]) => {
                  onScriptPausedChange(true);
                  onScriptFrameChange(next);
                }}
                aria-label="Scrub the script preview"
              />
              {timeline && timeline.events.length > 0 ? (
                <ScrubberMarks
                  events={timeline.events}
                  frameCount={timeline.frames.length}
                  onSeek={(frame) => {
                    onScriptPausedChange(true);
                    onScriptFrameChange(frame);
                  }}
                />
              ) : null}
            </div>
```

The slider loses `className="flex-1"`, because the column around it now takes the row's spare width, and the marks line up under the slider's own width.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run typecheck && bunx vitest run src/lego`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lego/pages/components/ScrubberMarks.tsx src/lego/pages/components/AnimationPanel.tsx src/lego/pages/components/AnimationPanel.dom.test.tsx
git commit -m "Mark the frames a script announced something on, under the scrubber"
```

---

### Task C6: full check, a look in the app, and the PR

- [ ] **Step 1: Run the seven CI commands**

```bash
bunx biome ci .
bun run typecheck
bun run test
scripts/mission-tests.sh
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

Expected: each exits 0. Report any failure with its output.

- [ ] **Step 2: Look at it in the app**

Tell the user the branch is ready for `bun tauri dev`, and what to look at: open BA's Hulk (`armtship` from `balanced_annihilation-v15.9.8.sdz`) in the model editor, pick "Loading a ship or hover transport" and play. The stand-in rides `link` while the boom swings, disappears on the pad, and the scrubber shows marks for both attaches. It stays hidden to the end of the run, because the drop arrives with part B. Hovering a mark lists its events, and clicking one jumps the scrubber there.

If you verify on screen yourself rather than waiting for the user, read "Driving the app" in `CLAUDE.md` first and follow part B's Task B6 steps 1 to 4 for a separate portable instance. Never drive an app you did not start.

- [ ] **Step 3: File the PR**

Use the `file-pr` skill. The description says why C lands before B, the `fromRelease` fallback that B removes, and what was checked on screen and how. Get the user's approval before creating it.
