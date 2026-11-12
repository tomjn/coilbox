# Sealed outposts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sealed planets' placeholder cuboids with designed metal structures on foundation plates, laid out on bare ground with no streets.

**Architecture:** A sealed outpost gets its own inventory (`outposts.ts`), layout (`layoutOutpost`), colourways and plates, beside the open town code, which does not change. The layer branches on settlement style. Presets take a colourway at build time and the layer caches each pair.

**Tech Stack:** TypeScript, three.js, vitest, the landmark kit and material.

**Spec:** `docs/superpowers/specs/2026-11-12-sealed-outposts-design.md`

## Global Constraints

- The lot is 0.75. Preset heights span 0.18 to 3.6.
- Sealed planets: `red`, `moon`, `volcanic`, `acid`.
- No street sheet, no streets, no cleared lanes on a sealed outpost.
- Colourway colours are absolute sRGB, never multiplied by the planet's wall colour.
- No stretch on sealed structures.
- Every PR's base is `main`. No stacked PRs.
- `bun run check` passes before each PR, run alone with nothing else loading the machine.
- Comments and docs follow the repo's plain English style. The humanize hook blocks semicolons and listed words.

## Review Focus

1. An outpost on steep or wet ground with no buildable lot: it gets nothing, or one lowest preset at its centre if the centre is buildable. Never a structure in water. Test in Task 4.
2. A 2x1 or 2x2 preset beside the edge: every lot it covers must be inside the edge and buildable, not only its first. Test in Task 4.
3. A shared plate across a slope: it reaches down to the lowest ground under its whole rectangle, so no daylight shows under it. Test in Task 6.
4. Fog and selection on an outpost with no street sheet: `setStyle` must not touch a sheet that is absent. Test in Task 6.
5. Red's copper colourway limited to domes and capsules: a planet and family pair with every colourway excluded must still find one. Test in Task 2.

---

## PR 1: groundwork (Opus)

### Task 1: Hazard stripe kind

**Files:**
- Modify: `src/conquest/galaxy3d/landmarks/kit.ts` (the `Kind` type and its doc comment)
- Modify: `src/conquest/galaxy3d/landmarks/material.ts` (fragment shader)
- Test: `src/conquest/galaxy3d/landmarks/material.test.ts`

**Interfaces:**
- Produces: `Kind` includes `14`, hazard stripes: painted metal in diagonal bands of the vertex colour and near black.

- [ ] **Step 1: Write the failing test** `it("draws hazard stripes as painted metal")`: the fragment shader has a branch for kind 14 (`/vKind > 13\.5/`), and the bare metal test no longer counts 14 as bare (`/step\(12\.5, vKind\)\s*\*\s*step\(vKind, 13\.5\)/`).
- [ ] **Step 2: Run** `bun run test src/conquest/galaxy3d/landmarks/material.test.ts`. Expected: FAIL on the new test.
- [ ] **Step 3: Implement.** Add 14 to `Kind`. In the fragment shader, a kind 14 branch: `u` along the wall as the other patterns pick it, bands on `(u + vLocal.y) / 0.06`, the dark band `base * 0.12`, faded to the bands' average by `fwidth` as the glass branch fades. Upward faces take the same bands on `vLocal.x + vLocal.z`. Paint wear applies to 11 to 14. `bare = step(12.5, vKind) * step(vKind, 13.5)`.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit** "Draw hazard stripes on a landmark's painted metal".

### Task 2: Colourways

**Files:**
- Create: `src/conquest/galaxy3d/towns3d/outpostColourways.ts`
- Test: `src/conquest/galaxy3d/towns3d/outpostColourways.test.ts`

**Interfaces:**
- Produces:
```ts
export type SealedPlanetId = "red" | "moon" | "volcanic" | "acid";
export type OutpostFamily = "dome" | "deck" | "stacked" | "spire" | "saucer"
  | "fortress" | "capsule" | "research" | "utility" | "placeholder";
export interface Colourway {
  id: string; share: number; families?: readonly OutpostFamily[];
  hull: Rgb; hull2: Rgb; accent: Rgb; trim: Rgb; metal: Rgb; glass: Rgb; stripe: Rgb;
}
/** A colourway with what settles on the planet: its `top` and `topCover` from `townPalette`, and dust stains for a wall's foot. */
export interface OutpostPaint extends Colourway { top: Rgb; topCover: number; dust: Stain[] }
export const OUTPOST_COLOURWAYS: Record<SealedPlanetId, readonly Colourway[]>;
export function isSealedPlanet(p: PlanetId | undefined): p is SealedPlanetId;
/** `pick` in 0 to 1, weighted by share among the colourways that suit `family`. */
export function colourwayFor(planet: SealedPlanetId, family: OutpostFamily, pick: number): Colourway;
export function outpostPaint(planet: SealedPlanetId, c: Colourway): OutpostPaint;
```

- [ ] **Step 1: Write failing tests:** every planet has at least one colourway and shares above 0. Every family on every planet has a colourway from `colourwayFor` at picks 0, 0.5 and 0.999. `colourwayFor("red", "deck", p)` never returns a colourway whose `families` leaves out `deck`. Ids are unique per planet. `outpostPaint` carries the planet's `townPalette` top and a dust stain whose `at` is 1 at y = 0 and 0 at y = 0.3.
- [ ] **Step 2: Run** `bun run test src/conquest/galaxy3d/towns3d/outpostColourways.test.ts`. Expected: FAIL, no module.
- [ ] **Step 3: Implement** with the spec's starting sets, four or five colourways per planet, the common ones holding most of the share. Red's copper has `families: ["dome", "capsule"]`. The dust stain colour is the planet's `top`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** "Give each sealed planet its outposts' colourways".

### Task 3: Outpost inventory

**Files:**
- Create: `src/conquest/galaxy3d/towns3d/outposts.ts`
- Create, empty: `outpostDomes.ts`, `outpostIndustry.ts`, `outpostTowers.ts`, each `export const X: OutpostModel[] = []` (`OUTPOST_DOMES`, `OUTPOST_INDUSTRY`, `OUTPOST_TOWERS`), so PR 2's agents each own one file
- Modify: `src/conquest/galaxy3d/towns3d/buildings.ts` (drop the cuboids and the `SEALED` constant)
- Test: `src/conquest/galaxy3d/towns3d/outposts.test.ts`, and `buildings.test.ts` where it expects sealed models

**Interfaces:**
- Consumes: Task 2's `OutpostFamily`, `OutpostPaint`.
- Produces:
```ts
export interface OutpostModel {
  id: string; family: OutpostFamily;
  lots: [number, number]; height: number;
  landmark?: boolean;
  /** Round on plan, so it may take any turn. */
  round?: boolean;
  build(b: Builder, w: number, d: number, paint: OutpostPaint): void;
}
export const OUTPOSTS: readonly OutpostModel[];
export function buildOutpost(m: OutpostModel, w: number, d: number, paint: OutpostPaint): THREE.BufferGeometry;
```
The ten cuboids move here as family `"placeholder"`, painted `hull` in kind 11 with the paint's top and dust. `OUTPOSTS` lists the three family files first, then the placeholders.

- [ ] **Step 1: Write failing tests,** over every model in `OUTPOSTS` and every colourway of every planet that suits its family: the geometry's min y is 0 within 1e-6, and its x and z lie within the footprint `lots * 0.75 - 2 * OUTPOST_GRID.setback` (import from Task 4, or a local constant until Task 4 lands). Ids are unique. At least one 1x1 model exists. Log each model's triangle count with `console.info`.
- [ ] **Step 2: Run** `bun run test src/conquest/galaxy3d/towns3d/outposts.test.ts`. Expected: FAIL, no module.
- [ ] **Step 3: Implement** the model file and move the cuboids.
- [ ] **Step 4: Run** the outposts and buildings tests. Expected: PASS. `modelsFor("sealed")` now returns `[]`, so fix any test that read sealed models from it to read `OUTPOSTS`.
- [ ] **Step 5: Commit** "Keep a sealed outpost's structures in their own inventory".

### Task 4: Outpost layout

**Files:**
- Modify: `src/conquest/galaxy3d/towns3d/layout.ts`
- Test: `src/conquest/galaxy3d/towns3d/layout.test.ts`

**Interfaces:**
- Consumes: `OutpostModel` fields `lots`, `height`, `landmark`, `round`.
- Produces:
```ts
export interface OutpostGrid {
  lot: number; setback: number; edgeDensity: number;
  /** Most a lone structure is pulled off its lot centre, world units. */
  jitter: number;
  /** Share of adjacent built neighbours joined by one plate. */
  join: number;
  /** How far a plate reaches past the footprint it carries. */
  plateMargin: number;
}
export const OUTPOST_GRID: OutpostGrid; // lot 0.75, setback 0.12, edgeDensity 0.7, jitter 0.06, join 0.5, plateMargin 0.04: starting guesses, tuned on screen
export interface Plate { x: number; z: number; turn: number; w: number; d: number }
export function layoutOutpost(
  town: Town, grid: OutpostGrid,
  models: readonly Pick<OutpostModel, "lots" | "height" | "landmark" | "round">[],
  ground: TownGround,
): { placements: Placement[]; plates: Plate[] };
```
`SEALED_GRID` and `gridFor` go. The layer and tests that used them take `OPEN_GRID` or `OUTPOST_GRID`. Extract the open town's height profile, `0.06 + 0.94 * (1 - t) ** 1.8`, into one function both layouts call.

Algorithm, where the tests do not fix it: lots are `(i + 0.5) * lot` from the centre in the town's frame, out to `town.radius * 1.3`. Visit lots nearest the centre first. A lot's want is null outside the edge or where not buildable, as `layoutTown` judges it, with no street test. Landmarks take the first lots for a city (1) or capital (2). Each free lot takes the preset nearest its want whose every lot is free and wanted. Each structure gets a plate of its footprint plus `plateMargin`. Then each pair of structures whose lot rectangles share an edge is joined with chance `join`. A join adds a bridge plate across the gap, as wide as the narrower of the two sides, and pins both structures to their lot centres. Lone structures get a jitter up to `jitter` each way, and a turn of a seeded quarter (square footprint), half (2x1) or any angle (`round`). Seeds come from the town's seed, as in `layoutTown`.

- [ ] **Step 1: Write failing tests:** `describe("layoutOutpost")`, with these cases:
  - every placement lies inside `townEdge` and no two cover the same lot
  - the same town gives deep-equal results twice
  - `town(0.3, [])` on flat ground gives exactly one placement
  - all ground unbuildable gives no placements and no plates
  - every lot a multi-lot preset covers is buildable, using a `buildable` that refuses one half-plane
  - with `join: 1`, every bridge plate touches two placements and those two sit at their lot centres
  - with `join: 0`, there is one plate per placement
  - a town with streets keeps structures on the street lines, so no lane is cleared
  - a capital-radius town places 2 landmarks and a city 1
- [ ] **Step 2: Run** `bun run test src/conquest/galaxy3d/towns3d/layout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** the layout tests. Expected: PASS.
- [ ] **Step 5: Commit** "Lay a sealed outpost out on bare ground, with no streets".

### Task 5: Foundation plate part

**Files:**
- Create: `src/conquest/galaxy3d/towns3d/outpostParts.ts`
- Test: `src/conquest/galaxy3d/towns3d/outpostParts.test.ts`

**Interfaces:**
- Produces: `export function foundationPlate(b: Builder, w: number, d: number, depth: number, paint: OutpostPaint, at: THREE.Matrix4): void`. This is a chamfered slab `w` by `d`, its top 0.03 above its origin, reaching `depth` below it, in `paint.trim` kind 11. It has a raised rim with a kind 14 stripe in `paint.stripe`, and light strips along the edges added through `b.glow`. Later parts for PR 2 go in this file too.

- [ ] **Step 1: Write failing test:** a plate's bounds span `w + rim` by `d + rim`, top at 0.03 within 1e-6, bottom at `-depth`. Some vertices carry kind 14.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** it with `chamfered` and `column` from `parts.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** "Stand a sealed outpost's structures on foundation plates".

### Task 6: Town layer for sealed outposts

**Files:**
- Modify: `src/conquest/galaxy3d/towns3d/townModelLayer.ts`
- Test: `src/conquest/galaxy3d/towns3d/townModelLayer.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces: no change to `TownModelLayer`.

On a sealed planet, the layer uses `layoutOutpost` with `OUTPOSTS`. It picks each placement's colourway with `colourwayFor(planet, family, rand())` and builds through a `Map<string, BufferGeometry>` keyed `${model.id}:${colourway.id}`, disposing of each entry once. Each plate is built with `foundationPlate`, its depth reaching the lowest ground under its four corners. Structures stand on their plate top. There is no street sheet, so `Placed.sheet` becomes optional and `setStyle` skips it. The ring and `built` count plates. The open town path does not change.

- [ ] **Step 1: Write failing tests:**
  - on a moon and on red, the scene has no street sheet mesh
  - `setStyle(i, { hidden: true, ring: ... })` does not throw on a sealed outpost
  - a sealed outpost's merged mesh includes kind 14 vertices from its plates
  - on a sloped surface, a plate's lowest vertex is at or below the lowest ground under its corners
  - building the same map twice builds each pair of preset and colourway once, counted through a spy on `buildOutpost`
  - `tops` and `rings` have an entry for each outpost
- [ ] **Step 2: Run** `bun run test src/conquest/galaxy3d/towns3d/townModelLayer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the whole `towns3d` folder. Expected: PASS.
- [ ] **Step 5: Commit** "Draw a sealed outpost's structures on plates, with no streets".

### Task 7: Harness, check and PR 1

- [ ] **Step 1:** Extend `docs/reports/town-3d/town.ts` (gitignored) so `view=model` takes an outpost id and `colourway=<id>&planet=<id>`. Add `view=gallery&planet=<id>`, which lays every outpost preset in every colourway of a planet out in rows.
- [ ] **Step 2:** Shoot one outpost on each sealed planet at distance 25 and tilt 1.25. Expected: cuboids on plates, bare ground, clusters joined.
- [ ] **Step 3:** Run `bun run check` alone. Expected: "All checks passed."
- [ ] **Step 4:** Offer the user a `bun tauri dev` look. Push, then file the PR with the `file-pr` skill against `main`, with the planet shots.

---

## PR 2: families (Fable 5.2 agents)

Branch from `main` after PR 1 merges.

### Task 8: Build all nine families roughly

Three Fable 5.2 agents in sequence, or at most two at once in this checkout. Each owns one file and touches no other, except adding parts to `outpostParts.ts`, which they append to and never edit:

| Agent | File | Families |
|---|---|---|
| A | `outpostDomes.ts` | habitat dome, capsule stack, utility |
| B | `outpostIndustry.ts` | industrial deck, perched fortress, research complex |
| C | `outpostTowers.ts` | stacked tower, spire, saucer tower |

Each brief carries:

- the spec
- the reference images' paths in `/Users/tomjn/.t3/userdata/attachments/`
- the harness commands
- the footprint and height rows from the spec's family table
- a cap of 12 harness shots
- one gallery shot to the user after the first family
- `outposts.test.ts` passing
- commits limited to the agent's own files, with explicit `git add`

They build every family roughly first, with no tuning loop.

- [ ] **Step 1:** Dispatch agent A. Relay its first gallery shot to the user.
- [ ] **Step 2:** Dispatch B, then C, as load allows.
- [ ] **Step 3:** Delete the placeholders from `outposts.ts`. Run `outposts.test.ts`. Expected: PASS with no placeholder ids.
- [ ] **Step 4:** Shoot the gallery for each planet and the four planet outposts at far, mid and closest zoom, plus one outpost fogged and one selected. Report the triangle totals of the sealed and open versions of the test map.
- [ ] **Step 5:** Stop for the user's review. Then `bun run check`, a `bun tauri dev` offer, and the PR against `main`.

## PR 3: tuning (Fable 5.2)

### Task 9: Changes from the user's review

- [ ] **Step 1:** One Fable agent applies the user's notes, capped shots, in the same files.
- [ ] **Step 2:** Run frame timing before and after on a quiet machine with `scripts/map-frame-timing`.
- [ ] **Step 3:** `bun run check`, a `bun tauri dev` offer, and the PR against `main`.
