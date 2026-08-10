# Setup packs as collections: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a setup pack into a collection of maps and games anyone can assemble and share, delete its empty page, and move authoring to the Coilbox hub screen.

**Architecture:** The pack manifest widens from one required game plus a non-empty map list to an optional list of each, valid when either has an entry. Authoring moves into a drawer opened from the hub header. Importing keeps its drawer and moves its landing route to Downloads > Maps, which no distribution profile can hide. The hub's "do I have this" check learns to count installed maps and games, not just the presets an import created.

**Tech Stack:** TypeScript, React 19, react-router, Vitest, Tauri 2, picoframe frame and shadcn registry components, biome.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-setup-packs-as-collections-design.md`.
- The feature keeps the name "Setup packs" in all user-facing copy, and `setup-pack` stays the wire kind. Do not rename either.
- Do not touch the curated map lists (`SuggestedMapList`, `MapPacksBanner`, `MapPacksDrawer`, the branding catalog, profile `mapLists`).
- Old pack codes must still decode: a payload with a single `game` object and no `games` reads as a one-game pack, and `engineVersion` is still parsed and resolved.
- Nothing authors `engineVersion` any more.
- Code blocks in this plan omit statement semicolons, because the doc linter rejects them. Write normal project style and run `bunx biome check --write <files>` before committing each task.
- Before the final commit run all four CI checks: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `bunx biome ci .`, `bun run typecheck`. Rust is untouched by this work, so clippy is a formality, not something to skip.
- UI components come from `@picoframe/frame` (`Button`, `Input`) or `src/components/ui/` (shadcn registry). Never native `select`, `checkbox` or `textarea`.

---

### Task 1: Widen the manifest

**Files:**
- Modify: `src/packs/manifest.ts:27-162`
- Test: `src/packs/manifest.test.ts`

**Interfaces:**
- Produces: `SetupPackManifest` with `title?: string`, `engineVersion?: string`, `games?: SetupPackGame[]`, `maps?: string[]`, `presets?: SetupPackPreset[]`. `parseSetupPackManifest(value: unknown): SetupPackManifest | null`. `requirementsForPack(manifest: SetupPackManifest): ContentRequirement[]`. `SetupPackGame` is unchanged.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing tests**

The existing `manifest()` helper in the test file builds the old shape, so change it first:

```ts
function manifest(
  overrides: Partial<SetupPackManifest> = {},
): SetupPackManifest {
  return {
    games: [{ name: "Beyond All Reason test-27000" }],
    maps: ["Red Comet Remake 1.8"],
    ...overrides,
  }
}
```

Then add a describe block:

```ts
describe("a pack as a collection", () => {
  it("takes several games", () => {
    const parsed = parseSetupPackManifest({
      games: [{ name: "Game A" }, { name: "Game B" }],
      maps: ["Map One"],
    })
    expect(parsed?.games?.map((g) => g.name)).toEqual(["Game A", "Game B"])
  })

  it("takes maps with no game", () => {
    const parsed = parseSetupPackManifest({ maps: ["Map One", "Map Two"] })
    expect(parsed?.maps).toEqual(["Map One", "Map Two"])
    expect(parsed?.games).toBeUndefined()
  })

  it("takes games with no maps", () => {
    const parsed = parseSetupPackManifest({ games: [{ name: "Game A" }] })
    expect(parsed?.games?.length).toBe(1)
    expect(parsed?.maps).toBeUndefined()
  })

  it("rejects a pack holding neither", () => {
    expect(parseSetupPackManifest({ presets: [] })).toBeNull()
    expect(parseSetupPackManifest({ games: [], maps: [] })).toBeNull()
  })

  it("keeps a title when given one", () => {
    const parsed = parseSetupPackManifest({
      title: "Popular water maps",
      maps: ["Map One"],
    })
    expect(parsed?.title).toBe("Popular water maps")
  })

  it("drops a blank title rather than carrying it", () => {
    const parsed = parseSetupPackManifest({ title: "  ", maps: ["Map One"] })
    expect(parsed?.title).toBeUndefined()
  })

  it("reads a pack shared before this as one game", () => {
    const parsed = parseSetupPackManifest({
      engineVersion: "105.1.1-2554-gabcdef",
      game: { name: "Beyond All Reason test-27000", rapidTag: "byar:test" },
      maps: ["Red Comet Remake 1.8"],
    })
    expect(parsed?.games).toEqual([
      { name: "Beyond All Reason test-27000", rapidTag: "byar:test" },
    ])
    expect(parsed?.engineVersion).toBe("105.1.1-2554-gabcdef")
  })

  it("asks for every game and every map", () => {
    const reqs = requirementsForPack(
      manifest({
        games: [{ name: "Game A" }, { name: "Game B" }],
        maps: ["Map One", "Map Two"],
      }),
    )
    expect(reqs.filter((r) => r.kind === "game").map((r) => r.label)).toEqual([
      "Game A",
      "Game B",
    ])
    expect(reqs.filter((r) => r.kind === "map").length).toBe(2)
  })

  it("asks for nothing but maps when the pack pins no game", () => {
    const reqs = requirementsForPack({ maps: ["Map One"] })
    expect(reqs.every((r) => r.kind === "map")).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/packs/manifest.test.ts`
Expected: FAIL. The multi-game and maps-only cases return null, and the existing suite no longer typechecks against the new `manifest()` helper.

- [ ] **Step 3: Widen the interface and the parser**

In `src/packs/manifest.ts`, replace the `SetupPackManifest` interface:

```ts
export interface SetupPackManifest {
  /** What the collection is called, so a code pasted with no hub item behind
   * it can name itself on arrival. */
  title?: string
  /** Only ever set by packs shared before a pack became a collection. Still
   * resolved on import, never authored. */
  engineVersion?: string
  games?: SetupPackGame[]
  maps?: string[]
  presets?: SetupPackPreset[]
}
```

Add a per-game parser above `parseSetupPackManifest`:

```ts
/** One entry of a pack's game list, or null when the shape is wrong. */
function parsePackGame(value: unknown): SetupPackGame | null {
  if (typeof value !== "object" || value === null) return null
  const g = value as Record<string, unknown>
  if (typeof g.name !== "string" || !g.name.trim()) return null
  if (g.rapidTag !== undefined && typeof g.rapidTag !== "string") return null
  // A pack shared before issue #1335 carries no shortname, which reads as an
  // identity with only a name rather than a malformed pack.
  const identity = parseGameIdentity(g) ?? {}
  return {
    name: g.name,
    ...(identity.shortname ? { shortname: identity.shortname } : {}),
    ...(typeof g.rapidTag === "string" && g.rapidTag.trim()
      ? { rapidTag: g.rapidTag }
      : {}),
  }
}
```

Replace the body of `parseSetupPackManifest` between the engine version block and the presets block:

```ts
  if (d.title !== undefined && typeof d.title !== "string") return null
  const title =
    typeof d.title === "string" && d.title.trim() ? d.title.trim() : undefined

  // `game` is the single-game shape every pack used before a pack became a
  // collection. Read as a one-entry list so those codes still import.
  const rawGames = Array.isArray(d.games)
    ? d.games
    : d.game !== undefined
      ? [d.game]
      : []
  const games: SetupPackGame[] = []
  for (const raw of rawGames) {
    const game = parsePackGame(raw)
    if (!game) return null
    games.push(game)
  }

  let maps: string[] = []
  if (d.maps !== undefined) {
    if (
      !Array.isArray(d.maps) ||
      !d.maps.every((m) => typeof m === "string" && m.trim())
    ) {
      return null
    }
    maps = d.maps as string[]
  }

  // A pack with nothing in it is an authoring mistake, not something to import
  // as an empty collection.
  if (games.length === 0 && maps.length === 0) return null
```

And the return:

```ts
  return {
    ...(title ? { title } : {}),
    ...(engineVersion ? { engineVersion } : {}),
    ...(games.length ? { games } : {}),
    ...(maps.length ? { maps } : {}),
    ...(presets ? { presets } : {}),
  }
```

Then `requirementsForPack`:

```ts
export function requirementsForPack(
  manifest: SetupPackManifest,
): ContentRequirement[] {
  return dedupeRequirements([
    ...(manifest.engineVersion
      ? [engineVersionRequirement(manifest.engineVersion)]
      : []),
    ...(manifest.games ?? []).map(gameRequirementForPack),
    ...(manifest.maps ?? []).map(exactMapRequirement),
  ])
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/packs/manifest.test.ts`
Expected: PASS. Existing tests in the file that read `manifest().game` need updating to `games[0]` as part of this step. `src/packs/pages/components/*.tsx` will not typecheck until Tasks 2 and 3, which is expected mid-plan.

- [ ] **Step 5: Commit**

```bash
bunx biome check --write src/packs/manifest.ts src/packs/manifest.test.ts
git add src/packs/manifest.ts src/packs/manifest.test.ts
git commit -m "A setup pack holds a list of games and a list of maps, either optional"
```

---

### Task 2: Rebuild the export drawer

**Files:**
- Create: `src/packs/build.ts`
- Create: `src/packs/build.test.ts`
- Modify: `src/packs/pages/components/ExportPackForm.tsx` (whole file)

**Interfaces:**
- Consumes: `SetupPackManifest`, `SetupPackGame`, `encodeSetupPack` from Task 1.
- Produces: `buildPackManifest(draft: PackDraft): SetupPackManifest | null` and `interface PackDraft { title: string, gameNames: string[], mapNames: string[], presets: SkirmishPreset[], installedGames: { name: string, shortname?: string }[] }` in `src/packs/build.ts`. Returns null when both name lists are empty.

The rapid tag field goes. One tag cannot describe several games, and a pack without one already falls back to the archive name as the download key (`gameRequirementForPack`). `rapidTag` stays on `SetupPackGame`, so packs that carry one still resolve it.

- [ ] **Step 1: Write the failing test**

Create `src/packs/build.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

// `build.ts` reaches `play/presets.ts` for the preset type, which reaches
// `useSetting` from the frame package. Stub it the way `manifest.test.ts` does.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [undefined, () => {}],
}))

import type { SkirmishPreset } from "../play/presets"
import { buildPackManifest } from "./build"

function preset(overrides: Partial<SkirmishPreset> = {}): SkirmishPreset {
  return {
    id: "id-1",
    name: "My preset",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
    participants: [],
    gameName: "Game A",
    mapName: "Map One",
    startPosType: 0,
    modOptionValues: {},
    ...overrides,
  }
}

describe("buildPackManifest", () => {
  it("builds a maps-only pack", () => {
    const built = buildPackManifest({
      title: "Popular water maps",
      gameNames: [],
      mapNames: ["Map One", "Map Two"],
      presets: [],
      installedGames: [],
    })
    expect(built).toEqual({
      title: "Popular water maps",
      maps: ["Map One", "Map Two"],
    })
  })

  it("fills each game's shortname from the installed list", () => {
    const built = buildPackManifest({
      title: "",
      gameNames: ["Game A"],
      mapNames: [],
      presets: [],
      installedGames: [{ name: "Game A", shortname: "ga" }],
    })
    expect(built?.games).toEqual([{ name: "Game A", shortname: "ga" }])
  })

  it("strips a preset's identity and timestamps", () => {
    const built = buildPackManifest({
      title: "",
      gameNames: [],
      mapNames: ["Map One"],
      presets: [preset()],
      installedGames: [],
    })
    expect(built?.presets?.[0]).not.toHaveProperty("id")
    expect(built?.presets?.[0]).not.toHaveProperty("createdAt")
    expect(built?.presets?.[0]?.name).toBe("My preset")
  })

  it("refuses a pack with no games and no maps", () => {
    expect(
      buildPackManifest({
        title: "Empty",
        gameNames: [],
        mapNames: [],
        presets: [preset()],
        installedGames: [],
      }),
    ).toBeNull()
  })

  it("never pins an engine version", () => {
    const built = buildPackManifest({
      title: "",
      gameNames: ["Game A"],
      mapNames: ["Map One"],
      presets: [],
      installedGames: [{ name: "Game A" }],
    })
    expect(built).not.toHaveProperty("engineVersion")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/packs/build.test.ts`
Expected: FAIL with a module-not-found error for `./build`.

- [ ] **Step 3: Write the builder**

Create `src/packs/build.ts`:

```ts
import { gameIdentityForName } from "../container/gameIdentity"
import type { SkirmishPreset } from "../play/presets"
import type { SetupPackGame, SetupPackManifest } from "./manifest"

/** What the export drawer has collected, before it becomes a manifest. */
export interface PackDraft {
  title: string
  gameNames: string[]
  mapNames: string[]
  presets: SkirmishPreset[]
  /** The scan's games, for filling in each pinned game's modinfo shortname. */
  installedGames: { name: string, shortname?: string }[]
}

/**
 * Turn what the drawer collected into a pack manifest, or null when the draft
 * names no content. Presets alone are not a pack: they have their own share
 * code, and a pack is a collection of things to install.
 */
export function buildPackManifest(draft: PackDraft): SetupPackManifest | null {
  if (draft.gameNames.length === 0 && draft.mapNames.length === 0) return null
  const games: SetupPackGame[] = draft.gameNames.map((name) => ({
    ...gameIdentityForName(name, draft.installedGames),
    name,
  }))
  const presets = draft.presets.map(
    ({ id: _id, createdAt: _createdAt, lastUsedAt: _lastUsedAt, ...rest }) =>
      rest,
  )
  return {
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    ...(games.length ? { games } : {}),
    ...(draft.mapNames.length ? { maps: draft.mapNames } : {}),
    ...(presets.length ? { presets } : {}),
  }
}
```

Read `gameIdentityForName` in `src/container/gameIdentity.ts` before writing this and match its real parameter shape rather than the one assumed above.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/packs/build.test.ts`
Expected: PASS, five tests.

- [ ] **Step 5: Rewrite the export drawer around it**

In `src/packs/pages/components/ExportPackForm.tsx`:

- Drop the `target` prop, `useSkirmishDraft`, `isRealEngineVersion`, `OptionSelect`, the rapid tag `Input`, and the `gameName` and `rapidTag` state.
- Read the target inside the component the way `ImportPackForm` does, so the drawer does not hold a target read at open time: `const { target } = usePreferredTarget()`, then `useUnitsyncScan(target?.enginePath, target?.dataDir)`.
- Keep `CheckList` exactly as it is.
- Add `const [title, setTitle] = useState("")` and a `selectedGames` set beside the existing `selectedMaps` and `selectedPresetIds` sets, toggled by the pattern already in the file.

The form gains a name field at the top:

```tsx
<div className="flex flex-col gap-1.5">
  <Label htmlFor="pack-title">Name</Label>
  <Input
    id="pack-title"
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    placeholder="e.g. Popular water maps"
  />
</div>
```

The game picker becomes a `CheckList` over `withoutGeneratedGames(scan.data?.games ?? [])` with `emptyMessage="No games installed for this engine."`, above the existing maps and presets lists.

`onExport` calls the new builder:

```tsx
const onExport = () => {
  setError(null)
  const built = buildPackManifest({
    title,
    gameNames: [...selectedGames],
    mapNames: [...selectedMaps],
    presets: presets.filter((p) => selectedPresetIds.has(p.id)),
    installedGames: games,
  })
  if (!built) {
    setError("Pick at least one game or map first.")
    return
  }
  setCode(encodeSetupPack(built))
}
```

Update the file's doc comment and the `ChallengeCodeView` help text. A pack now offers its games and maps as downloads and no longer carries an engine version.

- [ ] **Step 6: Verify it compiles**

Run: `bun run typecheck`
Expected: errors only in `SetupPacksPage.tsx` (still passing a `target` prop) and `ImportPackForm.tsx` (still reading `pending.game`). Both are fixed in Tasks 3 and 5.

- [ ] **Step 7: Commit**

```bash
bunx biome check --write src/packs/build.ts src/packs/build.test.ts src/packs/pages/components/ExportPackForm.tsx
git add src/packs/build.ts src/packs/build.test.ts src/packs/pages/components/ExportPackForm.tsx
git commit -m "Build a pack from any mix of installed games, maps and presets"
```

---

### Task 3: Import a pack of several games

**Files:**
- Modify: `src/packs/pages/components/ImportPackForm.tsx:39-141`
- Modify: `src/packs/build.ts` (add one helper)
- Test: `src/packs/build.test.ts`

**Interfaces:**
- Consumes: `buildPackManifest` and `PackDraft` from Task 2, the widened `SetupPackManifest` from Task 1.
- Produces: `aiGameNameForPack(manifest: SetupPackManifest): string | undefined` in `src/packs/build.ts`.

Reconciling a bundled preset's AI picks needs one game's AI list, and `useSkirmishAis` is a hook, so it cannot run once per game. The rule: use the game the first bundled preset names, falling back to the pack's first game. A pack whose presets span two games reconciles against the first, and the existing `aisReady` guard already makes that a no-op rather than a rewrite when the list does not settle.

- [ ] **Step 1: Write the failing test**

Add to `src/packs/build.test.ts`, importing `aiGameNameForPack` alongside `buildPackManifest` and `SetupPackManifest` as a type:

```ts
describe("aiGameNameForPack", () => {
  it("uses the game the first bundled preset names", () => {
    const { id: _id, createdAt: _c, lastUsedAt: _l, ...bundled } = preset({
      gameName: "Game B",
    })
    expect(
      aiGameNameForPack({
        games: [{ name: "Game A" }, { name: "Game B" }],
        presets: [bundled],
      }),
    ).toBe("Game B")
  })

  it("falls back to the pack's first game with no presets", () => {
    expect(aiGameNameForPack({ games: [{ name: "Game A" }] })).toBe("Game A")
  })

  it("has no answer for a maps-only pack", () => {
    expect(aiGameNameForPack({ maps: ["Map One"] })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/packs/build.test.ts`
Expected: FAIL, "aiGameNameForPack is not a function".

- [ ] **Step 3: Write the helper**

Append to `src/packs/build.ts`:

```ts
/**
 * Which game's AI list a pack's bundled presets should be reconciled against.
 * One list, because the caller reads it through a hook: the game the first
 * preset names, or the pack's first game when it bundles none.
 */
export function aiGameNameForPack(
  manifest: SetupPackManifest,
): string | undefined {
  return manifest.presets?.[0]?.gameName ?? manifest.games?.[0]?.name
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run src/packs/build.test.ts`
Expected: PASS, eight tests.

- [ ] **Step 5: Update the import drawer**

In `src/packs/pages/components/ImportPackForm.tsx`, replace the game archive lookup:

```tsx
const aiGameName = pending ? aiGameNameForPack(pending) : undefined
const gameArchive = scan.data?.games.find((g) => g.name === aiGameName)
  ?.primaryArchive.name
```

Give the resolve gate the pack's own name:

```tsx
<ResolveContentGate
  title={pending.title ?? "Set up this pack"}
  requirements={requirementsForPack(pending)}
  target={target ?? undefined}
  targetLoading={targetLoading}
  onContinue={applyPack}
  onCancel={() => setPending(null)}
/>
```

Replace the no-presets notification body, currently "The engine, game and maps are ready.", with a count of what arrived, since a pack no longer implies one game:

```tsx
const counts = [
  pending.games?.length
    ? `${pending.games.length} game${pending.games.length === 1 ? "" : "s"}`
    : null,
  pending.maps?.length
    ? `${pending.maps.length} map${pending.maps.length === 1 ? "" : "s"}`
    : null,
].filter(Boolean)
```

and use `` `${counts.join(" and ")} ready.` `` as the body. Keep the preset branch as it is.

Update the two help strings on `ChallengeCodeInput` so neither promises an engine.

- [ ] **Step 6: Verify it compiles**

Run: `bun run typecheck`
Expected: the only remaining error is `SetupPacksPage.tsx`, deleted in Task 5.

- [ ] **Step 7: Commit**

```bash
bunx biome check --write src/packs/build.ts src/packs/build.test.ts src/packs/pages/components/ImportPackForm.tsx
git add src/packs/build.ts src/packs/build.test.ts src/packs/pages/components/ImportPackForm.tsx
git commit -m "Import a pack that names several games, or none"
```

---

### Task 4: Move the importer to Downloads > Maps

**Files:**
- Modify: `src/deeplink/actions.ts:125-133`
- Modify: `src/deeplink/actions.test.ts:62`
- Modify: `src/deeplink/readImport.test.ts:52`
- Modify: `src/downloads/pages/MapsPage.tsx`

**Interfaces:**
- Consumes: `ImportPackForm` from Task 3.
- Produces: `/downloads/maps?import=<code>` as the setup pack importer route.

The landing route cannot be `/hub`. It is wrapped in `gated()` (`src/hub/index.tsx:39`), which redirects home when the hub is off or hidden, so a pasted code would vanish. `downloads.maps` is deliberately absent from `HIDEABLE_NAV_IDS`, so it is always reachable.

- [ ] **Step 1: Update the route assertions**

In `src/deeplink/actions.test.ts:62` and `src/deeplink/readImport.test.ts:52`, change both expected routes from `/content/setup-packs?import=` to `/downloads/maps?import=`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/deeplink`
Expected: FAIL, two assertions, each showing the old `/content/setup-packs` route.

- [ ] **Step 3: Point the deep link at the new route**

In `src/deeplink/actions.ts`, in the `case "setup-pack":` block, change `importRoute("/content/setup-packs", code)` to `importRoute("/downloads/maps", code)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/deeplink`
Expected: PASS.

- [ ] **Step 5: Host the import drawer on the maps download page**

In `src/downloads/pages/MapsPage.tsx`, copy the pattern from the page being deleted (`src/packs/pages/SetupPacksPage.tsx:34-71`), which is the same one `SkirmishPage.tsx` uses for preset codes:

```tsx
const { code: importCode, hubItemId } = useImportParam()
const recordHubImport = useRecordHubImport()
const drawer = useDrawer()

const openPackImport = async (initialCode?: string) => {
  const { ImportPackForm } = await import(
    "../../packs/pages/components/ImportPackForm"
  )
  drawer.open({
    title: "Import a setup pack",
    width: "26rem",
    content: (
      // A fresh form every time, because the last one may still be mounted and
      // would keep the code it already ran (issue #1395).
      <ImportPackForm
        key={nextDrawerKey()}
        initialCode={initialCode}
        onImported={(presetIds) =>
          recordHubImport(
            hubItemId,
            presetIds,
            presetIds[0] ? presetRoute(presetIds[0]) : "/downloads/maps",
          )
        }
      />
    ),
  })
}

// biome-ignore lint/correctness/useExhaustiveDependencies: run once when the deep-link code arrives, not on every drawer identity change
useEffect(() => {
  if (importCode) void openPackImport(importCode)
}, [importCode])
```

`onImported` grows a second argument in Task 6, so leave this call as written for now.

- [ ] **Step 6: Verify by hand**

Run: `bun tauri dev`. Task 2's authoring drawer has no button until Task 5, so take a pack code from the old export flow or hand-write one, paste it into Settings > Import, and confirm it lands on Downloads > Maps with the resolve drawer open and the pack's name in its title.

- [ ] **Step 7: Commit**

```bash
bunx biome check --write src/deeplink/actions.ts src/deeplink/actions.test.ts src/deeplink/readImport.test.ts src/downloads/pages/MapsPage.tsx
git add src/deeplink/actions.ts src/deeplink/actions.test.ts src/deeplink/readImport.test.ts src/downloads/pages/MapsPage.tsx
git commit -m "A pack code lands on Downloads > Maps, which no profile can hide"
```

---

### Task 5: Remove the page and open the drawer from the hub

**Files:**
- Delete: `src/packs/pages/SetupPacksPage.tsx`
- Modify: `src/content/index.ts:80-92,138-145`
- Modify: `src/hub/pages/BrowsePage.tsx:252-261`
- Modify: `src/profile/hidden.tsx:23-38`
- Modify: `docs/routes.md:29`, `docs/distribution-profile.md`

**Interfaces:**
- Consumes: `ExportPackForm` from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the Share a pack button**

In `src/hub/pages/BrowsePage.tsx`, in the header's right-hand button row beside `Hub website`:

```tsx
{!isProfileHidden("content.setupPacks") && (
  <Button variant="outline" size="sm" onClick={openExport}>
    <Package2 size={16} /> Share a pack
  </Button>
)}
```

with the opener above it:

```tsx
const drawer = useDrawer()
const openExport = async () => {
  const { ExportPackForm } = await import(
    "../../packs/pages/components/ExportPackForm"
  )
  drawer.open({
    title: "Share a setup pack",
    width: "26rem",
    content: <ExportPackForm />,
  })
}
```

Import `useDrawer` from `@picoframe/frame`, `Package2` from `lucide-react`, and `isProfileHidden` from `../../profile/hidden`.

- [ ] **Step 2: Delete the page and its route**

Delete `src/packs/pages/SetupPacksPage.tsx`. In `src/content/index.ts`, remove the Setup packs nav item (around line 86) and replace the `content/setup-packs` route with a redirect, alongside the existing legacy ones:

```ts
{
  path: "content/setup-packs",
  lazy: async () => ({
    default: makeLegacyRedirect(() => "/downloads/maps"),
  }),
},
```

Update the file's doc comment, which currently explains why setup packs route through the content plugin.

- [ ] **Step 3: Repoint the profile key**

In `src/profile/hidden.tsx`, keep `content.setupPacks` in `HIDEABLE_NAV_IDS` and add to the doc comment above it:

```ts
 * `content.setupPacks` is the one id here that no longer names a nav item. It
 * hides the hub screen's "Share a pack" button, so a distribution that switched
 * pack sharing off keeps it off now the page has gone.
```

- [ ] **Step 4: Update the docs**

In `docs/routes.md:29`, the Setup packs row becomes a redirect to `#/downloads/maps`, written the way the other legacy rows in that table are. In `docs/distribution-profile.md`, the `content.setupPacks` row changes from "Content > Setup packs" to the hub screen's Share a pack button.

- [ ] **Step 5: Verify**

Run: `bun run typecheck` then `bunx vitest run`
Expected: both clean.

Then `bun tauri dev`: the Content group has no Setup packs entry, the hub header has Share a pack, the drawer builds a code from any mix of games and maps, and `#/content/setup-packs` redirects to Downloads > Maps.

- [ ] **Step 6: Commit**

```bash
bunx biome check --write src/content/index.ts src/hub/pages/BrowsePage.tsx src/profile/hidden.tsx
git add src/content/index.ts src/hub/pages/BrowsePage.tsx src/profile/hidden.tsx docs/routes.md docs/distribution-profile.md
git rm src/packs/pages/SetupPacksPage.tsx
git commit -m "Share a pack from the hub screen, and retire the Setup packs page"
```

---

### Task 6: Presence counts installed content

**Files:**
- Modify: `src/hub/importRecord.ts:29-39,112-136`
- Modify: `src/hub/imports.ts:39-127`
- Modify: `src/packs/pages/components/ImportPackForm.tsx`
- Modify: `src/downloads/pages/MapsPage.tsx`
- Test: `src/hub/importRecord.test.ts`

**Interfaces:**
- Consumes: the widened manifest from Task 1, the importer wiring from Task 4.
- Produces: `HubImportRecord.content?: { games: string[], maps: string[] }`, a fourth parameter on `presenceOf(record, local, routeFor?, installed?)` where `installed` is `{ games: ReadonlySet<string>, maps: ReadonlySet<string> } | null`, and `ImportPackForm`'s widened `onImported?: (presetIds: string[], content: { games: string[], maps: string[] }) => void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/hub/importRecord.test.ts`:

```ts
describe("a pack that left only content behind", () => {
  const record = {
    id: "item-1",
    refs: [],
    route: "/downloads/maps",
    at: "2026-01-01T00:00:00.000Z",
    content: { games: ["Game A"], maps: ["Map One", "Map Two"] },
  }

  it("is here when every map and game it named is installed", () => {
    expect(
      presenceOf(record, new Set(), undefined, {
        games: new Set(["Game A"]),
        maps: new Set(["Map One", "Map Two"]),
      }),
    ).toEqual({ state: "here", route: "/downloads/maps" })
  })

  it("is gone when one of its maps is missing", () => {
    expect(
      presenceOf(record, new Set(), undefined, {
        games: new Set(["Game A"]),
        maps: new Set(["Map One"]),
      }),
    ).toEqual({ state: "gone" })
  })

  it("waits while the installed content is unknown", () => {
    expect(presenceOf(record, new Set(), undefined, null)).toEqual({
      state: "unknown",
    })
  })

  it("is here on a surviving preset even with its content deleted", () => {
    expect(
      presenceOf(
        { ...record, refs: ["preset-1"] },
        new Set(["preset-1"]),
        undefined,
        { games: new Set(), maps: new Set() },
      ),
    ).toEqual({ state: "here", route: "/downloads/maps" })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/hub/importRecord.test.ts`
Expected: FAIL. `presenceOf` takes three parameters and answers `gone` for an empty `refs` list.

- [ ] **Step 3: Teach the record and the check about content**

In `src/hub/importRecord.ts`, add to `HubImportRecord` a `content` field, optional, holding a `games` string array and a `maps` string array, with this comment:

```ts
  /** The content this import asked to be installed, for a pack that bundled no
   * presets and so created no local ids. Names, not ids: a map and a game are
   * known by name in every store that holds them. */
```

Then widen `presenceOf`:

```ts
export function presenceOf(
  record: HubImportRecord | undefined,
  local: ReadonlySet<string> | null,
  routeFor?: (ref: string) => string,
  installed?: {
    games: ReadonlySet<string>
    maps: ReadonlySet<string>
  } | null,
): HubItemPresence {
  if (!record) return { state: "none" }
  if (!local) return { state: "unknown" }
  const alive = record.refs.find((ref) => local.has(ref))
  if (alive !== undefined) {
    return { state: "here", route: routeFor ? routeFor(alive) : record.route }
  }
  // A pack that bundled no presets left no ids behind, so what it asked for is
  // the only evidence it is still here. All of it, because a collection half
  // installed is not the collection somebody shared.
  if (record.content) {
    if (installed === null) return { state: "unknown" }
    if (installed) {
      const hasAll =
        record.content.games.every((g) => installed.games.has(g)) &&
        record.content.maps.every((m) => installed.maps.has(m))
      if (hasAll) return { state: "here", route: record.route }
    }
  }
  return { state: "gone" }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/hub/importRecord.test.ts`
Expected: PASS, including the file's existing cases.

- [ ] **Step 5: Wire the installed scan into the hub's presence hook**

In `src/hub/imports.ts`:

- `useRecordHubImport`'s returned callback takes an optional fourth argument, the same `content` shape, and passes it into the record it builds.
- `useHubItemPresence` reads the preferred target and its scan (`usePreferredTarget` from `@/play/config`, `useUnitsyncScan` from `@/content/config`), builds `installed` as two name sets, or `null` while the scan has not resolved, and passes it as `presenceOf`'s fourth argument.
- Rewrite the paragraph in the file's doc comment claiming a pack that bundles no presets "left nothing to point at". It now answers from its content.

In `src/packs/pages/components/ImportPackForm.tsx`, widen `onImported` and call it with the pack's own lists:

```tsx
onImported?.(savedIds, {
  games: (pending.games ?? []).map((g) => g.name),
  maps: pending.maps ?? [],
})
```

In `src/downloads/pages/MapsPage.tsx`, pass that content through to `recordHubImport` as its fourth argument, so a content-only import records something to check.

- [ ] **Step 6: Verify**

Run: `bunx vitest run` then `bun run typecheck`
Expected: both clean.

Then `bun tauri dev`: import a maps-only pack from the hub browse screen, confirm its card reads as imported afterwards, delete one of its maps, and confirm the card offers Import again.

- [ ] **Step 7: Commit**

```bash
bunx biome check --write src/hub/importRecord.ts src/hub/importRecord.test.ts src/hub/imports.ts src/downloads/pages/MapsPage.tsx src/packs/pages/components/ImportPackForm.tsx
git add src/hub/importRecord.ts src/hub/importRecord.test.ts src/hub/imports.ts src/downloads/pages/MapsPage.tsx src/packs/pages/components/ImportPackForm.tsx
git commit -m "A pack is still here when the content it named is installed"
```

---

### Task 7: Full check before the PR

- [ ] **Step 1: Run every check CI runs**

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
bunx biome ci .
bun run typecheck
bunx vitest run
```

Expected: all clean. Clippy compiles the Tauri app crate, so run `bun run sidecar:unitsync` first if it cannot find the sidecar.

- [ ] **Step 2: Hand test the whole flow**

Run `bun tauri dev`, then:

- The hub screen shows Share a pack. Build a pack of two games and no maps, then one of maps only.
- Paste each code into Settings > Import. Both land on Downloads > Maps with the pack's name on the resolve drawer.
- A pack with presets still adds them, and Singleplayer > Presets lists them.
- `#/content/setup-packs` redirects to Downloads > Maps.
- The Content group has no Setup packs entry.

- [ ] **Step 3: Report what was and was not verified**

State plainly which of the above ran and what the output was. Do not claim the hub presence check works unless a real hub item was imported and its card checked.
