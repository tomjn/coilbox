# Warpath landmarks implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Procedural 3D strongholds on every enemy capital of a land map, warpath and conquest, and at most one ruined castle on a warpath event stop.

**Architecture:** A new folder `src/conquest/galaxy3d/landmarks/` holds a geometry kit, a self-lit material with a baked shadow, planet palettes, pure site picking, the two models and a layer that `GalaxyView` builds after the terrain mesh. Towns whose node carries a landmark are omitted from the town paint but stay in road planning and keep their index.

**Tech stack:** TypeScript, three.js, vitest (node environment), Tauri MCP for on-screen checks.

**Spec:** `docs/superpowers/specs/2026-11-11-warpath-landmarks-design.md`. Read it before any task.

**Port source:** `docs/reports/warpath-landmarks/` (gitignored, throwaway). Copy code from `kit.ts`, `bastion.ts`, `megabase.ts` (`MEGA_PALETTES`, `shield`), `fortress.ts` (`on`, `polar`, `seeded`, `tube`, `TAU`) and `citadel.ts`. Never import from it.

## Global constraints

- No windows, doors, ramps, vehicles or other human-scale detail. No saturated glowing faces. The shield is the only effect. The only lit parts are the stronghold's small lamp points and reactor collars, as in `bastion.ts`.
- Landmark palettes take nothing from `Planet.settlement` or any town colour.
- A hand-made map with no planet uses the temperate palettes.
- The terrain shader (`terrainShader.ts`) is not changed. `renderer.shadowMap` stays off.
- Landmark meshes set `raycast = () => {}`.
- Every geometry, material and render target goes into `disposables`.
- Comments follow the repo's plain English style. No em dashes.
- Before any PR: `bun run check` passes. PRs go through the `file-pr` skill.

## Review focus

1. A capital on a coast with no dry ground under any candidate site: the stop keeps its town and nothing throws. Test in Task 4.
2. Two enemy capitals close together: each stronghold shrinks to the town cap, and the two footprints do not overlap. Test in Task 4.
3. Performance mode, or a hand-made map without towns, plans no towns: strongholds still draw, and no town index is used. Test in Task 8.
4. A hand-made map whose colour is an image rather than raw pixels: no edge colour blend, temperate palette, no throw. Test in Task 8.
5. Reopening the map many times: every render target and geometry is disposed. Test in Task 8.

---

### Task 1: Geometry kit

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/kit.ts`
- Test: `src/conquest/galaxy3d/landmarks/kit.test.ts`

**Interfaces:**
- Produces:
  - `type Rgb = [number, number, number]`
  - `type Kind = 0 | 2 | 7 | 8` (masonry for the ruin, rock, bare trim, cast panels).
  - `interface Paint { kind?: Kind; top?: Rgb; topCover?: number; clean?: boolean; tint?(x,y,z): number; fade?(x,y,z): number; blend?(x,z): Rgb | undefined; blendWeight?(x,z): number }`. `blend` and `blendWeight` are new: the colour a vertex is pulled towards and by how much, for the crag edge.
  - `type PartTag = "body" | "tower" | "mast" | "crag"`
  - `at, on, polar, box, shaft, block, sweep, tube, seeded, noise3, TAU` with the spike's signatures.
  - `class Builder { add(g, color: Rgb, m: Matrix4, paint?: Paint, tag?: PartTag): void; glow(g, color: Rgb, m: Matrix4, gain?: number): void; build(): BuiltLandmark }`
  - `interface BuiltLandmark { solid: THREE.BufferGeometry; soft: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null; triangles: number; bounds(tag: PartTag): THREE.Box3 | null; vertices(tag: PartTag): Float32Array }`

`build()` returns geometries, not meshes. The layer picks the material. Each solid and soft geometry carries `position`, `normal`, `color` (3 or 4 wide), `kind` and `part` (the tag's index) attributes.

- [ ] **Step 1: Write the failing tests**

```ts
it("merges parts and keeps their colour, kind and tag", () => {
  const b = new Builder();
  b.add(box(1, 1, 1), [128, 128, 128], at(0, 0, 0), { kind: 8 }, "tower");
  b.add(box(1, 1, 1), [128, 128, 128], at(3, 0, 0), { kind: 2 }, "crag");
  const built = b.build();
  expect(built.solid.getAttribute("kind")).toBeDefined();
  expect(built.bounds("tower")?.max.x).toBeCloseTo(0.5);
  expect(built.bounds("crag")?.min.x).toBeCloseTo(2.5);
  expect(built.bounds("mast")).toBeNull();
});
it("pulls a vertex to the blend colour by its weight", () => {
  const b = new Builder();
  b.add(box(1, 1, 1), [0, 0, 0], at(0, 0, 0), { clean: true, blend: () => [255, 255, 255], blendWeight: () => 1 });
  const c = b.build().solid.getAttribute("color");
  expect(c.getX(0)).toBeCloseTo(1, 2);
});
it("draws the same parts from the same seed", () => {
  const a = seeded(7);
  const b = seeded(7);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});
```

- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/kit.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Port `kit.ts`** from the spike's `kit.ts` and the helpers from `fortress.ts` and `bastion.ts` (`block`, `sweep`). Drop `gable`, `cone` and the masonry material. Apply `blend` after weathering and tint, as the final colour step, in linear space.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/conquest/galaxy3d/landmarks/kit.ts src/conquest/galaxy3d/landmarks/kit.test.ts && git commit -m "Add the landmark geometry kit"`

### Task 2: Planet palettes

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/palettes.ts`
- Test: `src/conquest/galaxy3d/landmarks/palettes.test.ts`

**Interfaces:**
- Consumes: `PlanetId`, `PLANETS` from `src/conquest/planets.ts`. `Rgb` from Task 1.
- Produces:
  - `interface StrongholdPalette { concrete; armour; trim; rock; top: Rgb; topCover: number; lamp: Rgb; shield: Rgb }`
  - `interface RuinPalette { stone; darkStone; rock; top: Rgb; topCover: number }`
  - `STRONGHOLD_PALETTES: Record<PlanetId, StrongholdPalette>`, `RUIN_PALETTES: Record<PlanetId, RuinPalette>`
  - `strongholdPalette(planet?: PlanetId)` and `ruinPalette(planet?: PlanetId)`, temperate when `planet` is undefined.

Temperate and volcanic stronghold values are copied from `MEGA_PALETTES`. The other five start as a guess: each planet's rock and ground hue from `planetOf(id).biomes`, at the volcanic palette's saturation. They are tuned on screen in Task 10. Ruin values start from the spike's `PALETTES` stone colours for temperate and volcanic and are tuned in Task 11. This task only pins the shape.

- [ ] **Step 1: Write the failing test.** For every id in `PLANETS`, both lookups return a palette with every channel in 0 to 255, and `strongholdPalette(undefined)` equals `STRONGHOLD_PALETTES.temperate`.
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/palettes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write `palettes.ts`.**
- [ ] **Step 4: Run** it again. Expected: PASS. `bun run typecheck` passes, which proves the `Record` covers every planet.
- [ ] **Step 5: Commit** `"Add landmark planet palettes"`.

### Task 3: Which nodes get a landmark

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/kinds.ts`
- Modify: `src/conquest/galaxy3d/GalaxyView.tsx:124` (`NodeIdentity` gains `landmark?: "ruin"`)
- Modify: `src/runlite/galaxyAdapter.ts:620` (`mapRunIdentities`)
- Test: `src/conquest/galaxy3d/landmarks/kinds.test.ts`, `src/runlite/galaxyAdapter.test.ts`

**Interfaces:**
- Consumes: `NEUTRAL` from `src/conquest/model.ts`, `GalaxyNode`.
- Produces: `type LandmarkKind = "stronghold" | "ruin"` and `landmarkKinds(nodes: Pick<GalaxyNode, "id" | "kind" | "owner">[], playerFactionId: string, identities?: ReadonlyMap<string, { landmark?: "ruin" }>): Map<number, LandmarkKind>` keyed by node index.

A stronghold: `kind === "capital"` and `owner` is neither `playerFactionId` nor `NEUTRAL`. A ruin: the identity says so. If both apply, the stronghold wins.

The ruin pick: `mapRunIdentities` collects the event nodes that have a location, in `run.nodes` order, and picks index `floor(seeded(run.settings.seed)() * count)`. Use the seeded random helper `src/runlite` already has, if there is one. If there is none, port `seeded` from Task 1.

- [ ] **Step 1: Write the failing tests.**
  - `kinds.test.ts`: an enemy capital gets `"stronghold"`. The player's capital, a neutral capital and an enemy non-capital get nothing. A ruin identity gives `"ruin"`.
  - `galaxyAdapter.test.ts`: on a fixture run with three event stops, exactly one location has `landmark: "ruin"`, and the same seed picks the same one twice. A run with no events has none. On the doc from `mapRunToGalaxyDoc`, `landmarkKinds` with the run's `playerFactionId` gives the boss's index a stronghold and the start's index nothing. This is the spec's check that the start belongs to the player. If it fails, stop and report: the warpath's player faction is not the start's owner, and the rule needs a decision.
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/kinds.test.ts src/runlite/galaxyAdapter.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `landmarkKinds`, the identity field and the ruin pick.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `"Decide which locations carry a landmark"`.

### Task 4: Site, size and facing

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/site.ts`
- Test: `src/conquest/galaxy3d/landmarks/site.test.ts`

**Interfaces:**
- Consumes: `TerrainSurface` (`groundHeightAtWorld`, `mapToWorldXZ`, `heightScale`, `scale`).
- Produces:
  - `interface LandmarkSite { x: number; z: number; y: number; scale: number; facing: number; ground(x: number, z: number): number }`. `ground` takes the landmark's own unscaled coordinates and returns height in the same unscaled units, relative to `y`: `(surface.groundHeightAtWorld(site.x + x * scale, site.z + z * scale) - y) / scale`. It is turned by `facing` the same way the group is.
  - `pickSite(surface: TerrainSurface, at: [number, number], neighbours: [number, number][], toward: [number, number] | undefined, reach: number): LandmarkSite | null`. All positions in world units. `neighbours` are the other nodes' world positions. `toward` is the world position of the first linked node.

Rules, from the spec:
- `scale = min(1, 0.3 * nearestNeighbourDistance / reach)`. The 0.3 is the town cap in `towns.ts`. Import that constant if it is exported, rather than writing 0.3 again.
- Sea is below `(0.5 / 255) * surface.heightScale * surface.scale`, as in `townLayer.ts`.
- Candidates sit on a grid of step `reach * scale / 10`, out to `reach * scale / 5` from `at`. Each is sampled at 24 bearings at radii `0`, `0.5` and `1` times `reach * scale`. Drop any with a sample below sea. The score is the relief (highest less lowest sample) plus `0.01` times the distance from `at`. The lowest score wins.
- `facing` is the bearing from the site to `toward`, plus pi, so the long wall points away from the arriving road. Zero when `toward` is undefined.

- [ ] **Step 1: Write the failing tests** on `createTerrainSurface` with a hand-built height grid:
  - flat ground: the site equals `at`, and the scale is 1 when the nearest neighbour is far.
  - a slope rising to the east: the site moves west of `at`.
  - a neighbour at distance `d` with `0.3 * d < reach`: `scale * reach` is at most `0.3 * d`, and two strongholds at both nodes do not overlap.
  - every candidate over sea: returns `null`.
  - `ground(0, 0)` is 0 at the chosen site.
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/site.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `site.ts`.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `"Pick a landmark's site on the terrain"`.

### Task 5: Material and shield

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/material.ts`, `src/conquest/galaxy3d/landmarks/shield.ts`
- Test: `src/conquest/galaxy3d/landmarks/material.test.ts`

**Interfaces:**
- Consumes: `TERRAIN_SUN`, `SHADE_AMBIENT` from `terrain.ts`.
- Produces:
  - `landmarkMaterial(opts: { transparent?: boolean }): THREE.ShaderMaterial` with uniforms `uSun` (vec3), `uAmbient` (float), `uSky` and `uGroundBounce` (vec3), `uShadow` (sampler2D, null until baked), `uShadowMatrix` (mat4), `uShadowOn` (float), `uHidden` (float 0 or 1), `uMist` (float 0 or 1) and `uMistColour` (vec3).
  - `setLandmarkState(m: THREE.ShaderMaterial, s: { hidden: boolean; mist: boolean }): void`
  - `glowMaterial(): THREE.ShaderMaterial`, vertex colours, unlit, with the same `uHidden`.
  - `shieldMesh(p: StrongholdPalette, radii: THREE.Vector3, centre: THREE.Vector3): THREE.Mesh`, an upper half ellipsoid with those semi-axes.
  - `insideShield(radii: THREE.Vector3, centre: THREE.Vector3, point: THREE.Vector3): boolean`

Shader body, ported from the spike's `masonryMaterial` branches for kinds 0, 2, 7 and 8:
- The pattern coordinate is the `position` attribute (landmark space), not the world position. This is the spec's fix for scaling.
- Lighting: `diffuse * (uAmbient * hemisphere(normal) + max(dot(n, uSun), 0) * shadow)`. Start `uSky` and `uGroundBounce` from the spike's `HemisphereLight(0xcfe0ff, 0x6a5a48)` colours. Task 10 tunes the strengths against the `bastion3` shots.
- Hidden matches the town shader's fog: read the "hidden by fog" branch at `townShader.ts:960` and use the same grey and dimming.
- Mist matches `townShader.ts:964`: the same violet and strength.
- `soft` parts use the alpha of the 4-wide colour.

- [ ] **Step 1: Write the failing tests.**
  - `landmarkMaterial()` has every uniform named above.
  - The vertex shader assigns the pattern varying from `position`, and not from `modelMatrix`.
  - `setLandmarkState(m, { hidden: true, mist: false })` sets `uHidden` to 1.
  - `insideShield` is true at the centre and false just past each semi-axis.
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/material.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement both files.** The shield fragment shader is the spike's `shield()` one.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `"Add the landmark material and shield"`.

### Task 6: The stronghold

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/stronghold.ts`
- Test: `src/conquest/galaxy3d/landmarks/stronghold.test.ts`

**Interfaces:**
- Consumes: the Task 1 kit, the Task 2 `StrongholdPalette`, the Task 5 `insideShield`.
- Produces:
  - `STRONGHOLD_REACH = 3.6` (the spike's `BASTION_REACH`).
  - `buildStronghold(ground: (x: number, z: number) => number, p: StrongholdPalette, seed: number, edgeColour?: (x: number, z: number) => Rgb | undefined): { built: BuiltLandmark; shield: { radii: THREE.Vector3; centre: THREE.Vector3 } }`

Port `buildBastion` with these changes only:
- The model is built facing +x. The layer turns the group to `site.facing`, so drop the `gate` and `turn` maths and the `ct`/`st` rotation inside `crag`.
- Tag parts: the crag `"crag"`, the tower and its head `"tower"`, every `mast()` and `dish()` `"mast"`, and everything else `"body"`.
- Crag edge: `blend` is `edgeColour`, and `blendWeight` rises from 0 where the crag starts to fall off to 1 at its edge (the spike's `fall`, inverted). The `fade` edge gets noise: offset the fade distance by `(noise3(x * 2.1, 5, z * 2.1) - 0.5) * 0.5`. The crag sheet sits `0.03` lower at its outermost row.
- The shield is no longer scaled by hand. `centre` and `radii` come from the union of `bounds("tower")` and `bounds("mast")`, as a half ellipsoid on the crag top, grown by a margin of 0.15 on each axis. Then check every tower and mast vertex with `insideShield`, and grow all radii by 5 percent until they all pass.

- [ ] **Step 1: Write the failing tests** with `ground = () => 0` and the temperate palette:
  - every `"tower"` and `"mast"` vertex is inside the returned shield.
  - the solid has `"crag"`, `"tower"` and `"mast"` parts.
  - with `edgeColour = () => [255, 0, 0]`, the crag's outermost ring of vertices is red to within 0.02 in linear colour.
  - with `edgeColour` returning `undefined`, the crag keeps the palette's rock colour.
  - the footprint (the solid's bounding box in x and z) is within `STRONGHOLD_REACH` of the origin.
  - log `built.triangles` in the test output. It is the figure for the PR.
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/stronghold.test.ts`. Expected: FAIL.
- [ ] **Step 3: Port `stronghold.ts`.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `"Port the stronghold"`.

### Task 7: Baked shadow and ground decal

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/shadow.ts`
- Test: `src/conquest/galaxy3d/landmarks/shadow.test.ts`

**Interfaces:**
- Produces:
  - `shadowCamera(bounds: THREE.Box3, sun: THREE.Vector3): THREE.OrthographicCamera`, fitted so the whole box is inside its frustum.
  - `interface LandmarkShadow { target: THREE.WebGLRenderTarget; matrix: THREE.Matrix4; bake(renderer: THREE.WebGLRenderer, scene: THREE.Object3D): void; baked: boolean }` and `createLandmarkShadow(bounds, sun, size = 1024)`. The target has a `DepthTexture`. `bake` renders once with a depth material and sets `baked`.
  - `groundDecal(surface: TerrainSurface, site: LandmarkSite, reach: number, shadow: LandmarkShadow): { mesh: THREE.Mesh; setRing(ring: TownStyle["ring"] | undefined): void; setHidden(h: boolean): void }`. A disc of rings and segments from 0 to `reach * site.scale * 1.4`, its vertices at `surface.groundHeightAtWorld + 0.01` in world space. Its shader darkens by up to 0.5 where the shadow lookup is in shadow. It draws the contact darkening from the spike harness's catcher (alpha `0.42 * (1 - t)^2` past the crag lip). It draws a ring band at `reach * site.scale` that takes the town ring's colour, strength and thickness. It is `transparent` with `depthWrite: false`, drawn above the town patches (`-2.5`) and below the borders (`-2`).

The depth bake works in world space, so the shadow matrix is the camera's projection times view, with world-placed geometry. The landmark material and the decal both use it. Use `renderer.setRenderTarget` and restore the previous target afterwards.

- [ ] **Step 1: Write the failing tests.**
  - All eight corners of a box project inside `[-1, 1]` on x and y through `shadowCamera(box, sun)`.
  - Every decal vertex sits 0.01 above `groundHeightAtWorld` on a sloped surface.
  - `setRing(undefined)` sets the ring strength uniform to 0. `setRing({ color, strength: 0.95, thick: true })` sets it to 0.95.
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/shadow.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `shadow.ts`.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `"Bake a landmark's shadow and drape it on the ground"`.

### Task 8: The landmark layer

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/landmarkLayer.ts`
- Test: `src/conquest/galaxy3d/landmarks/landmarkLayer.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 7. `TownStyle` from `townLayer.ts`. `TerrainPixels` from `terrainLoad.ts`.
- Produces:
  - `interface LandmarkLayer { nodes: ReadonlySet<number>; setStyle(i: number, s: TownStyle): void; prepare(renderer: THREE.WebGLRenderer): void; anchors: { pos: [number, number] }[] }`. `nodes` holds the node indexes that got a landmark. `anchors` are in map units, for `endMarkersToDraw`.
  - `buildLandmarkLayer(scene, disposables, surface: TerrainSurface, galaxy: Pick<Galaxy, "nodes" | "links">, playerFactionId: string, identities: ReadonlyMap<string, { landmark?: "ruin" }> | undefined, planet: PlanetId | undefined, colour: TerrainColourReader | undefined): LandmarkLayer`
  - `type TerrainColourReader = (worldX: number, worldZ: number) => Rgb | undefined` and `terrainColourReader(color: TerrainPixels["color"], surface): TerrainColourReader | undefined`. It reads raw `{ data, width, height }` pixels and returns `undefined` for any other source.

For each entry of `landmarkKinds`:
1. `pickSite` with the node's world position, every other node's world position and the first linked node. `null` means skip it, so it stays out of `nodes`.
2. Build the model with a seed from a hash of the node id. Only `"stronghold"` exists until Task 11, so a `"ruin"` is skipped until then.
3. Add a `THREE.Group` at `(site.x, site.y, site.z)` with `rotation.y = site.facing` and `scale = site.scale`. It holds meshes for solid, soft and glow, and the shield, all with `raycast` a no-op. The shield is in the group, so it scales and turns with it.
4. Add the decal, in world space, outside the group.
5. Push every geometry, material, target and decal into `disposables`.

`setStyle(i, s)` calls `setLandmarkState` on that landmark's materials, and the decal's `setHidden` and `setRing`. Any `i` not in `nodes` is ignored. `prepare` bakes each unbaked shadow and returns. The bake renders a scene holding only that landmark's solid mesh.

- [ ] **Step 1: Write the failing tests** on a flat `createTerrainSurface` with a three-node galaxy: player capital, enemy capital, enemy plain node.
  - `nodes` holds only the enemy capital's index.
  - the group's scale is at most 1, and its meshes' `raycast` does nothing.
  - `setStyle(i, { hidden: true })` sets `uHidden` to 1 on the solid material. `setStyle` on a non-landmark index does not throw.
  - an enemy capital on a surface that is all sea is left out of `nodes`.
  - the build pushes to `disposables`, and calling every `dispose` disposes each `WebGLRenderTarget` it made (spy on `dispose`).
  - `terrainColourReader` returns `undefined` for an image-like source and a colour for raw pixels.
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/landmarkLayer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `landmarkLayer.ts`.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `"Add the landmark layer"`.

### Task 9: Wire it into the map

**Files:**
- Modify: `src/conquest/galaxy3d/townLayer.ts:97` (`buildTownLayer` gains a last parameter `omit: ReadonlySet<number> = new Set()`)
- Modify: `src/conquest/galaxy3d/GalaxyView.tsx` (around lines 754 to 1010, and `render()` at 1206)
- Modify: `src/conquest/galaxy3d/endMarkerLayer.ts:80` (`buildEndMarkerLayer` takes the landmark anchors)
- Modify: `src/conquest/galaxy3d/cityLayer.ts:383` (the `ground` argument gains `setLandmarkStyle?`)
- Test: `src/conquest/galaxy3d/cityLayer.test.ts`, `src/conquest/galaxy3d/endMarkerLayer.test.ts`, `src/conquest/galaxy3d/towns.test.ts`

Changes:
1. `buildTownLayer`: the `keep` callbacks passed to `townPatches` return false for any `k` in `omit`, so neither town nor field patches are emitted. The block bake gives an omitted town a null slot. Indexes do not move.
2. `GalaxyView`: build the landmark layer whether or not towns were planned, and before `buildTownLayer`, since it needs only nodes and the surface. Pass `landmarks.nodes` to `buildTownLayer` as `omit`. Call `landmarks?.prepare(renderer)` next to `towns?.prepare(renderer)`.
3. `cityLayer` `style()`: after `ground.setTownStyle?.(m.i, …)`, call `ground.setLandmarkStyle?.(m.i, …)` with the same style. `GalaxyView` passes `setLandmarkStyle: landmarks?.setStyle`.
4. `buildEndMarkerLayer`: add the landmark anchors to `galaxy.models` in the `endMarkersToDraw` calls, so the goal pole at a stronghold is not drawn.

- [ ] **Step 1: Write the failing tests.**
  - `towns.test.ts`: `townPatches` with a `keep` that refuses index 1 emits no vertex whose `town` attribute is 1.
  - `cityLayer.test.ts`: selecting a node calls `setLandmarkStyle` with that node's index and a thick ring.
  - `endMarkerLayer.test.ts`: a goal node with a landmark anchor at its position draws no marker. The start node, with none, still draws one.
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/towns.test.ts src/conquest/galaxy3d/cityLayer.test.ts src/conquest/galaxy3d/endMarkerLayer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the four changes.**
- [ ] **Step 4: Run** those tests, then `bun run test` and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Draw strongholds on the land map"`.

### Task 10: Stronghold on screen, then PR 1

Follow `CLAUDE.md` "Driving the app": a seeded portable instance, its own port and MCP socket, a second MCP server over stdio, and `multiplayer.autoConnect` false in the copy. Revert the socket edit before committing.

- [ ] **Step 1:** Start a land warpath on temperate. Take far, mid and close shots of the stronghold. Compare each with `docs/reports/warpath-landmarks/shots/bastion3-temperate-{far,mid,close}.jpg`. Tune `uAmbient`, `uSky`, `uGroundBounce` and the sun strength in `material.ts` until they match. Note the before and after values.
- [ ] **Step 2:** Check the crag edge against the forest at close zoom. It must show no hard outline. Tune the blend band and the fade noise if it does.
- [ ] **Step 3:** Repeat Step 1 on volcanic, against `bastion3-volcanic-*`.
- [ ] **Step 4:** Start runs on desert, ice, red, moon and acid. Tune each new stronghold palette until the model takes the planet's cast. Take one mid shot of each.
- [ ] **Step 5:** Open a conquest land map. Confirm every enemy capital has a stronghold, the player's capital has a town, and selection, hover and fog show on a stronghold.
- [ ] **Step 6:** Save every shot as a 1440 by 900 JPEG under `docs/reports/warpath-landmarks/product/` and post them in chat, one per image.
- [ ] **Step 7:** Commit any tuning. Run `bun run check`. Every lane must pass. Report the output if any fail.
- [ ] **Step 8:** File PR 1 with the `file-pr` skill. Attach the far, mid and close shots for temperate and volcanic with `gh --attach`.

### Task 11: The ruined castle, then PR 2

**Files:**
- Create: `src/conquest/galaxy3d/landmarks/ruin.ts`
- Modify: `src/conquest/galaxy3d/landmarks/landmarkLayer.ts` (build `"ruin"`) and `palettes.ts` (tune the ruin palettes)
- Test: `src/conquest/galaxy3d/landmarks/ruin.test.ts`

**Interfaces:**
- Produces: `RUIN_REACH`, set from the built footprint, and `buildRuin(ground, p: RuinPalette, seed: number, edgeColour?): { built: BuiltLandmark }`.

Built down from `citadel.ts`, per the spec: the mound at a lower height, two broken wall rings with gaps and rubble, some corner towers cut off at uneven heights, and the keep's lower stage as a shell. No halls, roofs, windows, banners, portcullis, turrets, trees, beam or glow. Masonry is `kind: 0`. The mound's skirt uses the same edge blend as the crag.

- [ ] **Step 1: Write the failing tests.** `buildRuin` has no glow geometry. Its footprint is smaller than `STRONGHOLD_REACH`. Each wall ring has at least one gap (sample the ring's angles for a run with no wall vertex).
- [ ] **Step 2: Run** `bunx vitest run src/conquest/galaxy3d/landmarks/ruin.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `ruin.ts`** and build it in the layer.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `"Add the ruined castle"`.
- [ ] **Step 6:** On screen as in Task 10: far, mid and close on temperate and volcanic, inside the event mist and with the mist off for comparison. Post the shots as 1440 by 900 JPEGs. Stop and wait for the user's approval. Work through their notes.
- [ ] **Step 7:** After approval, tune the other five ruin palettes, take one mid shot of each, run `bun run check`, and file PR 2 with the `file-pr` skill.
