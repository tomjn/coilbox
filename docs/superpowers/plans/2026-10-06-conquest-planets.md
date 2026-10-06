# Conquest planets implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A planet choice for the Territories and Cities map styles, with biome weights written by the generator and read by the shader and the farm-field check.

**Architecture:** A new `planets.ts` holds one record per planet. `terrainGen.ts` turns climate into up to eight biome weights a pixel, stores them as two RGBA arrays, and mixes the picture from them. The view uploads the weights as two textures, and the terrain shader and `farmableAt` read those in place of matching colours.

**Tech stack:** TypeScript, vitest, three.js with GLSL injected through `onBeforeCompile`, React with picoframe components.

**Spec:** `docs/superpowers/specs/2026-10-06-conquest-planets-design.md`

## Global constraints

- Generator arithmetic: integers, add, subtract, multiply, divide and `Math.sqrt` only. No `Math.sin`, `Math.cos`, `Math.pow`, `Math.exp`, `Math.log`, `Math.atan2` or `Math.hypot` anywhere under `buildTerrain`, including the crater step and every planet's weight rule.
- A Temperate map's land mask and heightmap stay byte-identical for every seed and shape. The picture may change.
- A document with no `generated.planet` is Temperate.
- The planet never draws from the generator's main random stream. It has a stream of its own.
- Hand-made maps and the galaxy style are untouched.
- Build every task before refining any. Use the starting values in this plan as given, take the first reasonable choice where the plan leaves one, and move on. No task adjusts how something looks. The user reviews the whole result and then says what to improve.
- Prefer `OptionSelect` and picoframe components over native elements.
- Paths below are relative to `src/conquest/` unless they start with `src/` or `docs/`.
- Run one test file with `bun run test <name>`. Before the last commit run all seven CI commands from the repo's `CLAUDE.md`.

## Review focus

1. A save or a settings file with a `planet` value nobody defined (edited by hand, or written by a newer build) reads as Temperate and the map opens. Test in task 5.
2. A share code that names Volcanic or Acid with a shape those planets do not offer builds one continent, and the same on a second decode. Test in task 5.
3. The drawer remembers "Two continents", then the player picks Volcanic. The shape falls back to "Surprise me" and the preview builds. Test in task 9.
4. Performance mode turns detail off. A non-Temperate planet still shows its own colours, and its sea shows no water foam, with no weight textures bound. Test in task 6.
5. Volcanic at the largest map size the drawer offers gives a connected map with no link of kind `crossing`. Test in task 5.

---

### Task 1: Planet records

**Files:**
- Create: `planets.ts`
- Test: `planets.test.ts`

**Interfaces:**
- Consumes: `hashString`, `mulberry32`, `pick` from `./rng`.
- Produces:

```ts
export type Rgb = [number, number, number]
export type PlanetId =
  | "temperate" | "desert" | "ice" | "red" | "moon" | "volcanic" | "acid"
export const PLANETS: readonly PlanetId[]   // in the order above
export const isPlanetId: (value: unknown) => value is PlanetId
export const BIOME_SLOTS = 8
/** Which of the shader's six existing patterns a slot draws with until piece 2. */
export type BiomePattern = "forest" | "grass" | "dry" | "tundra" | "rock" | "snow"
export interface Biome { name: string, colour: Rgb, farm: boolean, pattern: BiomePattern }
export type SeaLook = "water" | "acid" | "lava" | "ice" | "basin" | "maria"
export interface Planet {
  id: PlanetId
  label: string
  biomes: readonly Biome[]            // 1 to 8
  /** Slot a coast pixel on the sea side mixes towards. */
  shore: number
  /** Colours steep ground shows, darker then lighter, in sRGB. */
  steep: [Rgb, Rgb]
  /** Colour of a clearing in a `forest` pattern slot, in sRGB. */
  clearing: Rgb
  /** Added to moisture and to cold before the rule runs. */
  climate: { wet: number, cold: number }
  /** Fill `out` (length 8) with shares summing to 1. `h`, `wet`, `cold` are 0 to 1. */
  weights(h: number, wet: number, cold: number, out: Float64Array): void
  sea: { look: SeaLook, shallow: Rgb, deep: Rgb, crossing: "lane" | "solid" | "none" }
  craters: boolean
}
export function planetOf(id: PlanetId): Planet
/** `random` picks from the seed. Anything else that is not a planet id is Temperate. */
export function resolvePlanet(value: unknown, seed: number): PlanetId
/** Scale every share by `1 - t` and add `t` to `slot`. */
export function blend(out: Float64Array, slot: number, t: number): void
/** Bytes summing to 255: floor each share times 255, then give what is left to the largest share, lowest slot on a tie. */
export function weightBytes(shares: Float64Array, out: Uint8Array, offset: number): void
```

`resolvePlanet` picks with `pick(mulberry32(hashString(\`planet:${seed >>> 0}\`)), PLANETS)`.

Temperate's slots, in order, with today's colours from `terrainGen.ts:665`: grass, dry, forest, tundra, rock, scree, snow, beach. Farm is true for grass and dry. `shore` is beach. Its rule is `biomeColour` (`terrainGen.ts:700`) written with `blend`. Its sea is today's `SEA_SHALLOW` and `SEA_DEEP`, look `water`, crossing `lane`. `steep` is rock then scree, and `clearing` is grass.

The other six planets, with starting colours. These RGB values and climate numbers are my first picks, not measured from anything. Use them as given. The user tunes them after seeing the whole build.

| Planet | Slots (name, sRGB, pattern, farm) | Climate | Sea look, shallow, deep, crossing |
|---|---|---|---|
| desert | dunes 214,186,128 dry no. rock flats 168,138,104 rock no. mesa 150,96,70 rock no. scrub 150,148,96 grass yes. salt pan 226,220,204 snow no. beach 222,206,160 dry no | wet -0.35, cold -0.2 | water, 78,150,160, 30,78,104, lane |
| ice | snowfield 238,242,246 snow no. bare ice 176,208,224 snow no. tundra 132,138,126 tundra no. rock 104,104,110 rock no | wet 0, cold 0.6 | ice, 206,226,236, 150,186,206, solid |
| red | red dust 170,92,62 dry no. dark basalt 84,60,54 rock no. pale dunes 204,150,112 dry no. rock 128,78,60 rock no | wet -0.3, cold 0 | basin, 128,74,54, 92,54,44, solid |
| moon | regolith 142,142,146 dry no. bright highland 196,196,200 tundra no. rock 108,108,114 rock no | wet 0, cold 0 | maria, 86,88,96, 58,60,68, solid |
| volcanic | dark basalt 54,48,48 rock no. brown rock 96,70,54 rock no. ash 122,116,112 dry no. cooled flows 34,30,32 rock no | wet -0.2, cold -0.3 | lava, 240,120,30, 150,36,16, none |
| acid | dull yellow ground 156,148,96 dry no. brown ground 118,98,70 tundra no. brown forest 84,62,44 forest no. rock 110,104,92 rock no | wet 0, cold 0 | acid, 126,170,72, 52,96,40, none |

Each new planet's rule follows Temperate's shape: pick the lowland slot from `wet`, then `blend` towards the highland slots as `h` passes Temperate's thresholds (0.42, 0.66, 0.84). `craters` is true for moon only. `shore` is the beach slot where a planet has one and its first slot otherwise.

- [ ] **Step 1: Write the failing tests** in `planets.test.ts`

```ts
it("gives every planet 1 to 8 slots", () => {
  for (const id of PLANETS) {
    const n = planetOf(id).biomes.length
    expect(n).toBeGreaterThanOrEqual(1)
    expect(n).toBeLessThanOrEqual(BIOME_SLOTS)
  }
})
it("gives shares that sum to 1 with none in an unused slot", () => {
  for (const id of PLANETS) {
    const p = planetOf(id)
    const out = new Float64Array(BIOME_SLOTS)
    for (const h of [0, 0.01, 0.3, 0.5, 0.7, 0.9, 1])
      for (const wet of [0, 0.3, 0.45, 0.7, 1])
        for (const cold of [0, 0.5, 1]) {
          p.weights(h, wet, cold, out)
          expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
          for (let s = p.biomes.length; s < BIOME_SLOTS; s++) expect(out[s]).toBe(0)
          for (const v of out) expect(v).toBeGreaterThanOrEqual(0)
        }
  }
})
it("mixes Temperate to the colour biomeColour gave", () => {
  // h 0.5, wet 0.6, cold 0.2: the old chain gives this colour to within rounding.
  // Compute the expected value by copying biomeColour's chain into the test.
})
it("writes bytes that sum to 255", () => {
  const out = new Uint8Array(8)
  weightBytes(Float64Array.of(1 / 3, 1 / 3, 1 / 3, 0, 0, 0, 0, 0), out, 0)
  expect([...out]).toEqual([85, 85, 85, 0, 0, 0, 0, 0])
  weightBytes(Float64Array.of(0.5, 0.3, 0.2, 0, 0, 0, 0, 0), out, 0)
  expect(out.reduce((a, b) => a + b, 0)).toBe(255)
})
it("resolves a planet", () => {
  expect(resolvePlanet(undefined, 7)).toBe("temperate")
  expect(resolvePlanet("nonsense", 7)).toBe("temperate")
  expect(resolvePlanet("moon", 7)).toBe("moon")
  expect(resolvePlanet("random", 7)).toBe(resolvePlanet("random", 7))
  expect(new Set(Array.from({ length: 64 }, (_, s) => resolvePlanet("random", s))).size).toBeGreaterThan(1)
})
```

- [ ] **Step 2: Run** `bun run test planets` and confirm it fails because `./planets` does not exist.
- [ ] **Step 3: Implement `planets.ts`** to the interface above.
- [ ] **Step 4: Run** `bun run test planets` and confirm it passes.
- [ ] **Step 5: Commit** `planets.ts` and `planets.test.ts`.

---

### Task 2: The generator writes weights and mixes the picture from them

**Files:**
- Modify: `terrainGen.ts` (palette constants at 662 to 710, `climateColour` at 884, `resolveLandLayout` at 55, `TerrainOptions` and `GeneratedTerrain` at 87 to 118, `buildTerrain` at 926)
- Modify: `fixtures/territories/hashes.txt` and `fixtures/cities/` by regeneration
- Create: `terrainGen.test.ts`
- Test: `terrainGen.test.ts`, `terrainGolden.test.ts`, `citiesGolden.test.ts`

**Interfaces:**
- Consumes: everything task 1 produces.
- Produces:

```ts
export interface TerrainOptions { seed: number, shape: LandLayout, maxMasses?: number, planet?: PlanetId }
export interface TerrainBiomes { a: Uint8Array, b: Uint8Array }   // RGBA each, slots 0 to 3 and 4 to 7
export interface GeneratedTerrain { /* as now, plus */ planet: PlanetId, biomes: TerrainBiomes }
/** The shapes a planet offers: all six, or these four where the sea cannot be crossed. */
export const SINGLE_MASS_LAYOUTS: readonly LandLayout[]   // continent, coast, inlandsea, landlocked
export function landLayoutsFor(planet: PlanetId): readonly LandLayout[]
export function resolveLandLayout(layout: string | undefined, rng: Rng, planet?: PlanetId): LandLayout
/** The sRGB colour of a pixel's land from its weight bytes. `o` is the pixel's byte offset in `a` and `b`. */
export function landColour(planet: Planet, biomes: TerrainBiomes, o: number): Rgb
```

Decisions:

- `planet` left out is Temperate.
- `resolveLandLayout` with a planet whose crossing is `none`: an explicit shape outside `SINGLE_MASS_LAYOUTS` returns `continent` and draws nothing from `rng`. `random` draws once with `pick(rng, SINGLE_MASS_LAYOUTS)`. For every other planet it behaves exactly as now.
- `buildTerrain` passes `maxMasses: 1` to itself when the planet's crossing is `none`, whatever the caller gave.
- `climateColour` becomes a function that fills weight bytes for a land pixel: `wet` and `cold` as now, each with the planet's `climate` bias added and clamped to 0 to 1, then `planet.weights`, then `weightBytes`.
- The picture's land colour is `landColour`, the palette weighted by the bytes over 255. The hill shade and the coast mix stay as they are. A coast pixel on the sea side mixes towards the `shore` slot's colour, as it mixes towards `BEACH` today, and its weights stay 0.
- Sea pixels have all eight bytes 0.
- The sea ramp is built per planet from `sea.shallow` and `sea.deep`. Cache it by planet id.
- Delete the eight land colour constants, `SEA_SHALLOW`, `SEA_DEEP`, `SEA_RAMP` and `biomeColour`. Nothing else may hold a copy.

- [ ] **Step 1: Write the failing tests** in `terrainGen.test.ts`

```ts
const opts = { seed: 11, shape: "continent" as const }
it("keeps land and heights whatever the planet", () => {
  const base = generateTerrain(opts)
  for (const planet of PLANETS.filter((p) => planetOf(p).sea.crossing !== "none" && !planetOf(p).craters)) {
    const t = generateTerrain({ ...opts, planet })
    expect(t.land).toEqual(base.land)
    expect(t.heightmap).toEqual(base.heightmap)
  }
})
it("gives land weights that sum to 255 and sea none", () => {
  for (const planet of PLANETS) {
    const t = generateTerrain({ ...opts, planet })
    for (let i = 0; i < t.land.length; i++) {
      let sum = 0
      for (let c = 0; c < 4; c++) sum += t.biomes.a[i * 4 + c] + t.biomes.b[i * 4 + c]
      expect(sum).toBe(t.land[i] ? 255 : 0)
    }
  }
})
it("paints level inland ground in the palette mixed by the weights", () => {
  // For land pixels more than 6 coast-distance units inland whose north-west
  // and south-east heights are equal, image bytes equal landColour written
  // through a Uint8ClampedArray.
})
it("keeps one land mass where the sea cannot be crossed", () => {
  for (const planet of ["volcanic", "acid"] as const)
    for (const shape of landLayoutsFor(planet))
      expect(labelLandMasses(generateTerrain({ seed: 5, shape, planet, maxMasses: 40 })).sizes.length).toBe(1)
})
it("resolves a shape the planet does not offer to one continent", () => {
  const rng = mulberry32(3)
  expect(resolveLandLayout("archipelago", rng, "volcanic")).toBe("continent")
  expect(rng()).toBe(mulberry32(3)())
  expect(landLayoutsFor("volcanic")).toEqual(["continent", "coast", "inlandsea", "landlocked"])
  expect(landLayoutsFor("ice")).toEqual(LAND_LAYOUTS)
})
```

- [ ] **Step 2: Run** `bun run test terrainGen` and confirm the new tests fail.
- [ ] **Step 3: Implement** the changes listed under Decisions.
- [ ] **Step 4: Run** `bun run test terrainGen` and confirm it passes.
- [ ] **Step 5: Add the two weight arrays to the golden hashes.** In `terrainGolden.test.ts` and `citiesGolden.test.ts`, hash `biomes.a` and `biomes.b` alongside the land mask, the heightmap and the picture.
- [ ] **Step 6: Regenerate** with `UPDATE_TERRITORIES_GOLDEN=1 bun run test terrainGolden` and `UPDATE_CITIES_GOLDEN=1 bun run test citiesGolden`.
- [ ] **Step 7: Read the fixture diff.** On every line of `fixtures/territories/hashes.txt` the land mask hash, the heightmap hash and the document hash must be unchanged. Only the picture hash changes and the weight hashes are new. The whole documents checked in for the smallest size must not change at all. If any of those moved, the land changed, so stop and fix it.
- [ ] **Step 8: Run** `bun run test terrainGolden citiesGolden` without the update variables and confirm both pass.
- [ ] **Step 9: Commit** the source, the tests and the fixtures.

---

### Task 3: Craters on Moon

**Files:**
- Modify: `terrainGen.ts` (after the heightmap loop at 1013)
- Test: `terrainGen.test.ts`

**Interfaces:**
- Consumes: `Planet.craters`.
- Produces: no new export. `generateTerrain({ planet: "moon" })` returns a cratered heightmap.

Decisions:

- The step runs after `landHeightByte` has filled the heightmap and before the climate, on land pixels only.
- It uses its own stream, `mulberry32(hashString(\`craters:${seed >>> 0}\`))`.
- 40 craters, each with a radius of 4 to 18 pixels. Both numbers are my first picks. Use them as given. A centre is redrawn until it is on land and at least its radius plus 2 pixels from every side of the array, with at most 20 tries a crater, after which that crater is skipped.
- Inside 0.8 of the radius the height drops, deepest at the centre. From 0.8 to 1.2 of the radius it rises into a rim. The profile is a polynomial in the squared distance over the squared radius, so it needs only multiply and divide.
- Every land byte stays in 1 to 255. Sea pixels are never written.

- [ ] **Step 1: Write the failing tests**

```ts
it("craters the Moon without moving its coast", () => {
  const plain = generateTerrain({ seed: 9, shape: "continent" })
  const moon = generateTerrain({ seed: 9, shape: "continent", planet: "moon" })
  expect(moon.land).toEqual(plain.land)
  expect(moon.coastDistance).toEqual(plain.coastDistance)
  expect(moon.heightmap).not.toEqual(plain.heightmap)
  for (let i = 0; i < moon.land.length; i++)
    expect(moon.heightmap[i] === 0).toBe(moon.land[i] === 0)
})
it("leaves the Moon's edge rows and columns as they were", () => {
  // Row 0, row 511, column 0 and column 511 of the heightmap equal the plain terrain's.
})
```

- [ ] **Step 2: Run** `bun run test terrainGen` and confirm they fail.
- [ ] **Step 3: Implement** the crater step.
- [ ] **Step 4: Run** `bun run test terrainGen` and confirm it passes.
- [ ] **Step 5: Commit.**

---

### Task 4: Weights past the map's edge

**Files:**
- Modify: `terrainGen.ts` (`TerrainMargin` at 1151, `generateTerrainWithMargin` at 1213, `ExtendedTerrain` at 1379, `extendTerrain` at 1396)
- Test: `terrainGen.test.ts`

**Interfaces:**
- Consumes: task 2's weight filling and `landColour`.
- Produces:

```ts
export interface TerrainMargin { /* as now, plus */ biomes: TerrainBiomes }     // at the margin's own width and height
export interface ExtendedTerrain { /* as now, plus */ biomes: TerrainBiomes }  // at the extended width and height
```

`extendTerrain`'s `terrain` parameter gains `"biomes"` in its `Pick`.

Decisions:

- Inside the map the margin copies the map's weight bytes, as it copies the picture.
- Outside it fills weights and colours with the same functions the map uses, and the planet's sea ramp.
- `extendTerrain` copies the map's weights in the middle and blends the margin's with the same `blend` closure it uses for the picture.

- [ ] **Step 1: Write the failing tests**

```ts
it("carries weights past the edge", () => {
  const { terrain, margin } = generateTerrainWithMargin({ seed: 4, shape: "coast", planet: "desert" }, 64)
  const wide = extendTerrain(terrain, margin)
  expect(wide.biomes.a.length).toBe(wide.width * wide.height * 4)
  // The middle equals the map's own bytes exactly.
  const M = wide.margin
  for (const [x, y] of [[0, 0], [100, 200], [511, 511]]) {
    const o = ((y + M) * wide.width + (x + M)) * 4
    const m = (y * terrain.width + x) * 4
    expect([...wide.biomes.a.subarray(o, o + 4)]).toEqual([...terrain.biomes.a.subarray(m, m + 4)])
    expect([...wide.biomes.b.subarray(o, o + 4)]).toEqual([...terrain.biomes.b.subarray(m, m + 4)])
  }
})
it("leaves the map unchanged when it has a margin", () => {
  const plain = generateTerrain({ seed: 4, shape: "coast", planet: "desert" })
  const { terrain } = generateTerrainWithMargin({ seed: 4, shape: "coast", planet: "desert" }, 64)
  expect(terrain.biomes).toEqual(plain.biomes)
  expect(terrain.image).toEqual(plain.image)
})
```

- [ ] **Step 2: Run** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test terrainGen` and confirm it passes.
- [ ] **Step 5: Commit.**

---

### Task 5: The planet on the document, in the generators and in share codes

**Files:**
- Modify: `model.ts` (`generated` type at 315, its reader near 596)
- Modify: `generate.ts` (`GenerateOptions` at 131)
- Modify: `territories.ts` (`landTerrain` at 747, `generatedTerrain` at 762, `generatedTerrainWithMargin` at 772, and where `generateTerritories` writes `generated`)
- Modify: `cities.ts` (its call to `landTerrain`, and where it writes `generated`)
- Modify: `mapStyle.ts` (`regenerateGalaxy` at 126)
- Modify: `challenge.ts` (`ConquestChallengeSettings` at 40, `challengeSettingsFromGalaxy` at 133, `parseConquestChallengeSettings` at 171, `optionsFromChallenge` at 288)
- Test: `model.test.ts`, `challenge.test.ts`, `territories.test.ts`, `mapStyle.test.ts`

**Interfaces:**
- Consumes: `resolvePlanet`, `isPlanetId`, `planetOf`, `resolveLandLayout(layout, rng, planet)`.
- Produces:

```ts
// model.ts, inside GalaxyDoc["generated"]
planet?: PlanetId | "random"
// generate.ts, inside GenerateOptions
planet?: PlanetId | "random"
// challenge.ts, inside ConquestChallengeSettings
planet?: PlanetId | "random"
// territories.ts
export function landTerrain(
  seed: number,
  layout: GenerateOptions["layout"],
  locations: number,
  rng: Rng,
  planet?: GenerateOptions["planet"],
): GeneratedTerrain
```

Decisions:

- The stored value is what the player chose, so `random` is stored as `random` and resolved with `resolvePlanet(value, seed)` each time the land is built.
- The generators write `planet` into `generated` only when the options carry one. A document made without it has no such key, so the checked-in golden documents do not change.
- `model.ts` keeps `planet` when it is `random` or passes `isPlanetId`, and drops anything else.
- `challenge.ts` writes `planet` only when the document has one, and reads it with the same check. There is no version bump, following `LAYOUTS` at `challenge.ts:118`. Add a sentence to that comment saying an older coilbox builds the Temperate map of the same seed.
- `regenerateGalaxy` passes `g.planet` through, so a reroll keeps the planet.

- [ ] **Step 1: Write the failing tests**

```ts
// model.test.ts
it("keeps a known planet and drops an unknown one", () => {
  expect(readDoc({ ...doc, generated: { seed: 1, planet: "moon" } }).generated?.planet).toBe("moon")
  expect(readDoc({ ...doc, generated: { seed: 1, planet: "random" } }).generated?.planet).toBe("random")
  expect(readDoc({ ...doc, generated: { seed: 1, planet: "pluto" } }).generated?.planet).toBeUndefined()
})
// challenge.test.ts
it("carries the planet through a code", () => { /* encode a Territories doc with planet "ice", decode, expect settings.planet "ice" and optionsFromChallenge(...).planet "ice" */ })
it("reads a code with no planet as it always did", () => { /* decode an existing fixture code, expect settings.planet undefined */ })
it("builds one continent from a Volcanic code that names an archipelago", () => {
  /* settings with skin "territories", layout "archipelago", planet "volcanic": generateMap twice,
     both docs deep-equal, and labelLandMasses(generatedTerrain(doc)).sizes.length is 1 */
})
// territories.test.ts
it("writes no planet when none was asked for", () => { expect("planet" in (generateTerritories(base).generated ?? {})).toBe(false) })
it("builds the land of the planet it stores", () => {
  const doc = generateTerritories({ ...base, planet: "red" })
  expect(doc.generated?.planet).toBe("red")
  expect(generatedTerrain(doc)?.planet).toBe("red")
})
it("gives a Volcanic map of the largest size no crossings", () => {
  const count = Math.max(...LARGE_SIZES.map((s) => s.count))
  const doc = generateTerritories({ ...base, nodeCount: count, planet: "volcanic", layout: "random" })
  expect(doc.links.every((l) => l.kind !== "crossing")).toBe(true)
  // And every node is reachable from the first over doc.links.
})
it("does not let the planet choice move the land", () => {
  const a = generatedTerrain(generateTerritories({ ...base, planet: "desert" }))
  const b = generatedTerrain(generateTerritories(base))
  expect(a?.land).toEqual(b?.land)
})
// mapStyle.test.ts
it("keeps the planet on a reroll", () => { /* regenerateGalaxy of a doc with planet "ice" has generated.planet "ice" */ })
```

Use the reader, fixture and link field names those test files already use. The names above stand for them.

- [ ] **Step 2: Run** `bun run test model challenge territories mapStyle` and confirm the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `bun run test terrainGolden citiesGolden`, and confirm all pass with no fixture change.
- [ ] **Step 5: Pin each planet.** In `terrainGolden.test.ts` add one case per planet other than Temperate, at the smallest size and the `continent` shape, named so its line in `hashes.txt` carries the planet's id. Regenerate with `UPDATE_TERRITORIES_GOLDEN=1 bun run test terrainGolden` and confirm the diff only adds those six lines.
- [ ] **Step 6: Commit.**

---

### Task 6: The view uploads the weights and the shader reads them

**Files:**
- Modify: `mapStyle.ts` (`generatedTerrainPixels` at 92)
- Modify: `galaxy3d/terrainLoad.ts` (`TerrainPixels` at 23)
- Modify: `galaxy3d/terrainMesh.ts` (`TerrainExtension` at 112, `buildTerrainMesh` at 175)
- Modify: `galaxy3d/terrainShader.ts` (`TerrainShading` at 28, `BIOMES` at 185, the detail block at 212 to 331, `applyTerrainShader` at 361)
- Modify: `galaxy3d/GalaxyView.tsx` (the `buildTerrainMesh` call at 625)
- Test: `galaxy3d/terrainMesh.test.ts`, `mapStyle.test.ts`

**Interfaces:**
- Consumes: `GeneratedTerrain.biomes`, `GeneratedTerrain.planet`, `ExtendedTerrain.biomes`, `planetOf`.
- Produces:

```ts
// terrainMesh.ts
export interface BiomePixels { a: Uint8Array, b: Uint8Array, width: number, height: number, planet: PlanetId }
export interface TerrainExtension { /* as now, plus */ biomes?: BiomePixels }
// terrainLoad.ts
export interface TerrainPixels { /* as now, plus */ biomes?: BiomePixels }
// terrainShader.ts
export interface TerrainShading {
  normals: THREE.Texture | null
  /** The generator's weights and its planet. Null for a hand-made map, which gets no detail. */
  biomes: { a: THREE.Texture, b: THREE.Texture, planet: PlanetId } | null
  /** Draw the detail. Off in performance mode. */
  detail: boolean
  frame?: TerrainFrame
  ground?: GroundShading
}
```

`buildTerrainMesh` gains a last parameter `biomes?: BiomePixels`.

Decisions:

- `generatedTerrainPixels` returns `biomes` at the map's size and `extension.biomes` at the extended size.
- `buildTerrainMesh` uploads whichever set matches the picture it uses: the extension's when it draws the extension, otherwise the map's widened by `apronPicture` exactly as the picture is. Both textures are linear filtered with mipmaps, `flipY` false, and no colour space.
- New uniforms: `uBiomeA`, `uBiomeB` (samplers), `uBiomePattern[8]` (float, the index of each slot's pattern in the order forest, grass, dry, tundra, rock, snow, and -1 for an unused slot), `uBiomeSteep[2]` and `uBiomeClearing` (vec3, linear), and `uSeaLiquid` (1 for the `water` and `acid` looks, otherwise 0).
- In the detail block, the six `w` values are sums of the weight samples over the slots whose pattern matches. `tNear` and the `s` colour go. The existing renormalising by `total` stays, since filtering at the coast lets the sum fall below 1.
- `T_GRASS`, `T_ROCK` and `T_SCREE` in the albedo mixes become `uBiomeClearing` and `uBiomeSteep`. Delete the `BIOMES` string.
- Foam, the sea's ripples and its glint are multiplied by `uSeaLiquid`.
- Detail runs when `shading.detail`, `shading.biomes` and `shading.normals` are all set. The program cache key keeps its present form.
- In performance mode no weight textures are bound. The picture already has the planet's colours, so nothing else is needed.

- [ ] **Step 1: Write the failing tests**

```ts
// mapStyle.test.ts
it("hands the view the weights and the planet", () => {
  const px = generatedTerrainPixels(generateTerritories({ ...base, planet: "ice" }))
  expect(px?.biomes?.planet).toBe("ice")
  expect(px?.biomes?.a.length).toBe(512 * 512 * 4)
  expect(px?.extension?.biomes?.a.length).toBe(px!.extension!.image.width * px!.extension!.image.height * 4)
})
// terrainMesh.test.ts, with the scene helpers that file already has
it("binds the weights when detail is on and not when it is off", () => {
  // Build with biomes and detail true: compile the material's onBeforeCompile against a stub
  // shader and expect uniforms.uBiomeA.value to be a DataTexture and uTerrainDetail.value 1.
  // Build with detail false: uTerrainDetail.value 0.
})
it("turns water effects off on a sea that is not liquid", () => {
  // planet "moon": uniforms.uSeaLiquid.value is 0. planet "acid": 1.
})
it("gives a hand-made map no detail", () => {
  // No biomes passed: uTerrainDetail.value 0, as today for a picture given by URL.
})
```

- [ ] **Step 2: Run** `bun run test mapStyle terrainMesh` and confirm the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `bun run typecheck`, and confirm both pass.
- [ ] **Step 5: Commit.**

---

### Task 7: Fields follow the weights

**Files:**
- Modify: `galaxy3d/towns.ts` (`BIOMES` and `farmBiome` at 381 to 409, `farmableAt` at 417)
- Modify: `galaxy3d/townLayer.ts` (`buildTownLayer` at 84 and its `farmableAt` call at 115)
- Modify: `galaxy3d/GalaxyView.tsx` (the `buildTownLayer` call at 613)
- Test: `galaxy3d/towns.test.ts`

**Interfaces:**
- Consumes: `BiomePixels`, `planetOf(...).biomes[].farm`.
- Produces:

```ts
export function farmableAt(
  biomes: BiomePixels,
  worldWidth: number,
  worldDepth: number,
  buildable: (x: number, z: number) => number,
): (x: number, z: number) => number
```

`buildTownLayer`'s `picture?: ColorPixels` parameter becomes `biomes?: BiomePixels`.

Decisions:

- A texel is farm ground when the bytes of its farm slots sum to 128 or more, which is half of 255 rounded up. The rest of `farmableAt` is unchanged.
- Delete `farmBiome` and the `BIOMES` table, and their tests.
- `GalaxyView` passes `terrainPixels?.biomes`. `fieldsAnywhere` keeps its present meaning for a hand-made map.

- [ ] **Step 1: Write the failing tests**

```ts
it("puts fields on farm slots and nowhere else", () => {
  // A 2 by 1 BiomePixels for "temperate": texel 0 all grass (slot 0 = 255), texel 1 all forest (slot 2 = 255).
  // With buildable always 1: farmableAt(...) is 1 at texel 0's centre and 0 at texel 1's.
})
it("puts no fields on a planet with no farm slot", () => {
  // The same pixels read as "moon": 0 at both.
})
it("decides a blended texel by the larger share", () => {
  // grass 128, forest 127: 1. grass 127, forest 128: 0.
})
```

- [ ] **Step 2: Run** `bun run test towns` and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test towns townLayer` and `bun run typecheck`, and confirm both pass.
- [ ] **Step 5: Commit.**

---

### Task 8: Crossings over a sea that is not liquid

**Files:**
- Modify: `galaxy3d/crossingLine.ts` (the fragment shader's sea branch at 149, `crossingMaterial` at 193)
- Modify: `galaxy3d/cueLayer.ts` (`buildCueLayer` at 117, the `crossingMaterial` call at 352)
- Modify: `galaxy3d/GalaxyView.tsx` (the `buildCueLayer` call at 817)
- Test: `galaxy3d/cueLayer.test.ts`

**Interfaces:**
- Consumes: `planetOf(...).sea.crossing`.
- Produces:

```ts
export function crossingMaterial(width: number, lane: THREE.Color, solid?: boolean): THREE.ShaderMaterial
```

`buildCueLayer` gains a last parameter `solidCrossings = false`.

Decisions:

- A new uniform `uSolid`. When it is 1, the plain lane over the sea draws as a solid line `cover(y - 0.13, aa)`, the dots' own half width, in place of the dots. The arrowheads of an open Warpath step and every state drawn over the lane are unchanged.
- `GalaxyView` passes `true` when `terrainPixels?.biomes` names a planet whose crossing is `solid`.

- [ ] **Step 1: Write the failing tests**

```ts
it("draws crossings solid when asked", () => {
  // Build the cue layer with solidCrossings true: the crossing mesh's material.uniforms.uSolid.value is 1.
  // With it left out: 0.
})
```

- [ ] **Step 2: Run** `bun run test cueLayer` and confirm it fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test cueLayer` and confirm it passes.
- [ ] **Step 5: Commit.**

---

### Task 9: The planet picker in the generation drawer

**Files:**
- Modify: `generateChoices.ts` (`GenerateChoices` at 13, `readGenerateChoices` at 32)
- Modify: `pages/ConquestListPage.tsx` (`LAND_LAYOUT_OPTIONS` at 1125, `layoutOptionsFor` at 1135, the choices at 1326, `genOptions` at 1378, the "Shape" field at 1625)
- Create: `pages/components/PlanetSwatch.tsx`
- Create: `generateChoices.test.ts`
- Test: `generateChoices.test.ts`, `pages/ConquestGenerateChoices.dom.test.tsx`

**Interfaces:**
- Consumes: `PLANETS`, `planetOf`, `isPlanetId`, `landLayoutsFor`, `GenerateOptions.planet`.
- Produces:

```ts
// generateChoices.ts
export interface GenerateChoices { /* as now, plus */ planet: string }
// PlanetSwatch.tsx
export function PlanetSwatch({ planet }: { planet: PlanetId | "random" }): JSX.Element
```

Decisions:

- `PlanetSwatch` is an `aria-hidden` 16 pixel round `span`: the left half the first biome's colour and the right half the sea's shallow colour, by a CSS linear gradient with a hard stop at 50%. For `random` it is a neutral grey with a `?`.
- The options are "Surprise me" (`random`) first, then each planet's `label`, each with its swatch as the option's `icon` so it shows in the trigger too.
- The field is labelled "Planet" and sits directly above "Shape". It is shown only when `isLandSkin(style)`.
- `layoutOptionsFor(style, planet)` filters `LAND_LAYOUT_OPTIONS` to `random` plus `landLayoutsFor(planet)` for a land style. With `random` as the planet every shape is offered, since the generator resolves an unoffered shape to one continent.
- `planet` is read with `offeredOr(choices.planet, planetOptions, "random")`, and `layout` with the narrowed options, so a remembered shape that is no longer offered falls back to `random`.
- `genOptions` passes `planet` for a land style and leaves it out otherwise. Add `planet` to its dependency list and to whatever key the preview is memoised on.

- [ ] **Step 1: Write the failing tests**

```ts
// generateChoices.test.ts
it("reads a stored planet and drops one of the wrong type", () => {
  expect(readGenerateChoices({ planet: "ice" }).planet).toBe("ice")
  expect(readGenerateChoices({ planet: 3 }).planet).toBeUndefined()
})
// ConquestGenerateChoices.dom.test.tsx, with that file's render helper
it("offers a planet for a land style and not for a galaxy", async () => { /* style galaxy: no "Planet" label. style territories: the label and eight options. */ })
it("narrows the shapes for Volcanic", async () => { /* choose Volcanic, open Shape: Surprise me, One continent, Coast, Inland sea, Landlocked and no others */ })
it("drops a remembered shape Volcanic does not offer", async () => {
  /* stored choices { style: "territories", layout: "continents", planet: "volcanic" }:
     the Shape trigger reads "Surprise me" and generateMap is called with layout "random", planet "volcanic" */
})
it("falls back to Surprise me for a stored planet nobody defined", async () => { /* planet "pluto": the trigger reads "Surprise me" */ })
```

- [ ] **Step 2: Run** `bun run test generateChoices ConquestGenerateChoices` and confirm the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `bun run test ConquestGenerate` for the other drawer suites, and `bunx biome ci .`, and confirm all pass.
- [ ] **Step 5: Commit.**

---

### Task 10: Check on screen once, run the full suite

**Files:**
- Modify: `planets.ts` (colours, climate biases), `terrainGen.ts` (crater count and radius)
- Modify: `docs/conquest.md` (a short section on planets)
- Modify: golden fixtures by regeneration if any Temperate value was touched. None should be.

- [ ] **Step 1: Start a dev app** following "Driving the app" in the repo's `CLAUDE.md`. If one is already running in this checkout, use it and confirm which app the Tauri MCP is driving before believing a screenshot.
- [ ] **Step 2: Generate one Territories map per planet** from the drawer and screenshot each at a far zoom and a near zoom. Check: the ground and sea colours suit the planet, biomes are told apart at a glance, no foam or glint shows on ice, basin, maria or lava, crossings are solid where they should be, Volcanic and Acid have no crossings, Moon has craters, and fields appear only on Temperate and Desert.
- [ ] **Step 3: Record what is wrong and change nothing.** List anything that fails the checks in step 2. Fix a feature that does not work, such as foam on lava or a missing crossing. Leave colours, climate biases and crater numbers as they are, and report what looks off for the user to direct.
- [ ] **Step 4: Open a map saved before this branch** and confirm it loads as Temperate with its locations where they were.
- [ ] **Step 5: Write the planets section** of `docs/conquest.md`: what the picker does, the seven planets in a sentence each, and that Volcanic and Acid have one land mass.
- [ ] **Step 6: Run all seven CI commands**: `bunx biome ci .`, `bun run typecheck`, `bun run test`, `scripts/mission-tests.sh`, `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`. Report each result as it is.
- [ ] **Step 7: Commit.**
- [ ] **Step 8: Stop and hand over for testing with `bun tauri dev`** before any PR, as the repo's `CLAUDE.md` asks.
