# Conquest Galaxy Spacing + Reroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Galaxies get more space as star count grows (with varied spacing), and the player can regenerate a galaxy with a new seed both from a live 2D preview in the create wizard and in place on the galaxy page before a run starts.

**Architecture:** The renderer's fixed `PLAY_EXTENT` becomes a node-count-derived extent (constant density). The generator's dart-throwing acceptance distance gets per-candidate jitter. `GalaxyDoc.generated` grows optional knob fields written by `generateGalaxy` and validated by `parseGalaxyJson`; a pure `regenerateGalaxy` helper rerolls a doc in place from those knobs plus a caller-resolved content environment. UI: a pure-SVG `GalaxyPreview2D` in the wizard, a Regenerate button in `RunSetupPanel`.

**Tech Stack:** TypeScript + React (Tauri frontend), three.js (untouched except constants), vitest. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-07-09-conquest-spacing-reroll-design.md`

**Conventions:** run tests with `bun run test`. Commit after each task; no emoji, no AI attribution, don't change git user. The branch may be renamed by t3code automation; check `git branch --show-current` before each commit but do not switch branches.

---

### Task 1: `playExtentFor` + extent parameter in layout maths

**Files:**
- Modify: `src/conquest/galaxy3d/layout.ts`
- Test: `src/conquest/galaxy3d/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `layoutNodes` describe block in `src/conquest/galaxy3d/layout.test.ts` (import `BASE_NODE_COUNT` and `playExtentFor` from `./layout` in the existing import):

```ts
it("scales the longest span to a custom extent", () => {
  const laid = layoutNodes(nodes, 200);
  const a = laid.get("a");
  const b = laid.get("b");
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  if (!a || !b) return;
  expect(b[0] - a[0]).toBeCloseTo(200);
});
```

And a new describe block:

```ts
describe("playExtentFor", () => {
  it("returns PLAY_EXTENT at the baseline node count", () => {
    expect(playExtentFor(BASE_NODE_COUNT)).toBeCloseTo(PLAY_EXTENT);
  });

  it("scales with the square root of node count (constant density)", () => {
    expect(playExtentFor(BASE_NODE_COUNT * 4)).toBeCloseTo(PLAY_EXTENT * 2);
  });

  it("never collapses for tiny galaxies", () => {
    expect(playExtentFor(0)).toBeGreaterThan(0);
    expect(playExtentFor(1)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/conquest/galaxy3d/layout.test.ts` Expected: FAIL — `playExtentFor` / `BASE_NODE_COUNT` not exported; custom-extent test still spans 100.

- [ ] **Step 3: Implement**

In `src/conquest/galaxy3d/layout.ts`, after the `PLAY_EXTENT` constant add:

```ts
/** Node count whose play extent is exactly {@link PLAY_EXTENT} (the wizard's
 * Medium size), so pre-existing medium galaxies render unchanged. */
export const BASE_NODE_COUNT = 18;

/**
 * World-unit extent for a galaxy of `nodeCount` systems: area grows linearly
 * with the count, so average star density stays constant instead of packing
 * more stars into the same plane.
 */
export function playExtentFor(nodeCount: number): number {
  return PLAY_EXTENT * Math.sqrt(Math.max(1, nodeCount) / BASE_NODE_COUNT);
}
```

Change `layoutNodes` to accept the extent (default preserves current behaviour) and use it in place of `PLAY_EXTENT`:

```ts
export function layoutNodes(
  nodes: Pick<GalaxyNode, "id" | "pos">[],
  extent: number = PLAY_EXTENT,
): Map<string, WorldPos> {
```

and inside, replace `const scale = span > 0 ? PLAY_EXTENT / span : 0;` with:

```ts
  const scale = span > 0 ? extent / span : 0;
```

Also update the doc comment's "scales to {@link PLAY_EXTENT}" to "scales to `extent` (default {@link PLAY_EXTENT})".

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test src/conquest/galaxy3d/layout.test.ts` Expected: PASS (all existing tests too — the default keeps old behaviour).

- [ ] **Step 5: Commit**

```bash
git add src/conquest/galaxy3d/layout.ts src/conquest/galaxy3d/layout.test.ts
git commit -m "feat(conquest): node-count-derived play extent in layout maths"
```

---

### Task 2: GalaxyView adopts the dynamic extent

**Files:**
- Modify: `src/conquest/galaxy3d/GalaxyView.tsx` (import at line 13, layout call ~line 416, every `PLAY_EXTENT` use inside the component)

No unit test — this is three.js scene wiring; verified by typecheck now and live smoke in Task 8.

- [ ] **Step 1: Compute the extent where positions are laid out**

At `GalaxyView.tsx:415-416`, change:

```ts
    const skin = galaxy.theme?.skin ?? "galaxy";
    const positions = layoutNodes(galaxy.nodes);
```

to:

```ts
    const skin = galaxy.theme?.skin ?? "galaxy";
    // Bigger galaxies get a proportionally bigger plane (constant density);
    // the backdrop, nebulae and camera framing all scale with it.
    const extent = playExtentFor(galaxy.nodes.length);
    const positions = layoutNodes(galaxy.nodes, extent);
```

- [ ] **Step 2: Replace the remaining `PLAY_EXTENT` references with `extent`**

`grep -n "PLAY_EXTENT" src/conquest/galaxy3d/GalaxyView.tsx` currently shows uses at lines 490 (`const size = PLAY_EXTENT * 3.4;`), 531 (`const CORE_DIST = PLAY_EXTENT * 5.5;`), 540 (`PLAY_EXTENT * 7,`), 667 (`PLAY_EXTENT * 2.4,`), 700 (`PLAY_EXTENT * (0.7 + nebulaRng() * 1.6)`), 706 (`PLAY_EXTENT * (1.2 + nebulaRng() * 1.2)`), 1221-1222 (camera start height/pullback). Replace each `PLAY_EXTENT` token with `extent` (all are inside the same effect where `extent` is in scope). Then update the import at line 13 from:

```ts
import { hashString, layoutNodes, PLAY_EXTENT, playBounds } from "./layout";
```

to:

```ts
import { hashString, layoutNodes, playBounds, playExtentFor } from "./layout";
```

Verify no stragglers: `grep -n "PLAY_EXTENT" src/conquest/galaxy3d/GalaxyView.tsx` returns nothing.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck` Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/conquest/galaxy3d/GalaxyView.tsx
git commit -m "feat(conquest): scale galaxy scene and camera with node count"
```

---

### Task 3: Varied spacing in the generator

**Files:**
- Modify: `src/conquest/generate.ts:72-139` (`packWithSampler` + the four scatter functions)
- Test: `src/conquest/generate.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `generateGalaxy` describe block in `src/conquest/generate.test.ts`:

```ts
it("varies spacing between seeds (jittered acceptance distance)", () => {
  const a = generateGalaxy({ ...base, seed: 1 }, "t0");
  const b = generateGalaxy({ ...base, seed: 2 }, "t0");
  expect(a.nodes.map((n) => n.pos)).not.toEqual(b.nodes.map((n) => n.pos));
  // Nearest-neighbour distances are not uniform: spread should be visible.
  const nn = (doc: typeof a) =>
    doc.nodes.map((n) =>
      Math.min(
        ...doc.nodes
          .filter((m) => m.id !== n.id)
          .map((m) => Math.hypot(m.pos[0] - n.pos[0], m.pos[1] - n.pos[1])),
      ),
    );
  const d = nn(a);
  expect(Math.max(...d) / Math.min(...d)).toBeGreaterThan(1.5);
});
```

- [ ] **Step 2: Run test**

Run: `bun run test src/conquest/generate.test.ts` Expected: likely PASS already (plain dart-throwing has some NN spread) — that is fine; this test is a regression guard for determinism-per-seed and against a future change collapsing variance. Note the actual result honestly and continue.

- [ ] **Step 3: Implement the jitter**

In `src/conquest/generate.ts`, change `packWithSampler` (line 72) to take the rng and roll a per-candidate acceptance distance:

```ts
function packWithSampler(
  rng: Rng,
  count: number,
  radius: number,
  sample: () => Pt,
): Pt[] {
  const minDist = (radius * 1.6) / Math.sqrt(count);
  const pts: Pt[] = [];
  let relax = 0;
  while (pts.length < count) {
    const p = sample();
    // Varied spacing: each candidate rolls its own acceptance distance
    // (0.65..1.35 of the base, mean 1.0) so the field gets tight pairs and
    // open gaps instead of a uniform carpet.
    const need = minDist * (0.65 + rng() * 0.7) - relax;
    if (pts.every((q) => dist(p, q) >= need)) {
      pts.push(p);
      relax = 0;
    } else {
      relax += minDist / 50;
    }
  }
  return pts;
}
```

Update the four call sites to pass `rng` first: in `scatterDisc`, `scatterSpiral`, `scatterClusters`, `scatterRing`, change `return packWithSampler(count, radius, () => {` to `return packWithSampler(rng, count, radius, () => {` (the closing `});` lines are unchanged).

- [ ] **Step 4: Run the full conquest suite**

Run: `bun run test src/conquest` Expected: PASS — determinism, connectivity and round-trip tests all still hold (the jitter draws from the same seeded rng).

- [ ] **Step 5: Commit**

```bash
git add src/conquest/generate.ts src/conquest/generate.test.ts
git commit -m "feat(conquest): jitter star spacing for a less uniform scatter"
```

---

### Task 4: Persist the generation knobs

**Files:**
- Modify: `src/conquest/model.ts` (GalaxyDoc.generated type ~line 133, new `parseGenerated` helper, `parseGalaxyJson` return ~line 452)
- Modify: `src/conquest/generate.ts` (return block ~line 419)
- Test: `src/conquest/model.test.ts`, `src/conquest/generate.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/conquest/model.test.ts`, in the `parseGalaxyJson` describe block:

```ts
it("round-trips generation knobs and drops invalid ones", () => {
  const doc = galaxy({
    generated: {
      seed: 7,
      nodeCount: 16,
      factionCount: 2,
      layout: "ring",
      skin: "galaxy",
      startingSystems: 2,
      fogOfWar: true,
    },
  });
  expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);

  const raw = JSON.parse(JSON.stringify(doc));
  raw.generated.layout = "hexagon";
  raw.generated.nodeCount = 900;
  const parsed = parseGalaxyJson(JSON.stringify(raw));
  expect(parsed?.generated?.seed).toBe(7);
  expect(parsed?.generated?.layout).toBeUndefined();
  expect(parsed?.generated?.nodeCount).toBe(80);
});
```

`src/conquest/generate.test.ts`, in the `generateGalaxy` describe block:

```ts
it("persists the generation knobs for reroll", () => {
  const doc = generateGalaxy(
    { ...base, layout: "ring", skin: "theatre", startingSystems: 2, fogOfWar: true },
    "t0",
  );
  expect(doc.generated).toEqual({
    seed: 1234,
    nodeCount: 16,
    factionCount: 2,
    layout: "ring",
    skin: "theatre",
    startingSystems: 2,
    fogOfWar: true,
  });
  const defaults = generateGalaxy(base, "t0");
  expect(defaults.generated?.layout).toBe("scatter");
  expect(defaults.generated?.skin).toBe("galaxy");
  expect(defaults.generated?.startingSystems).toBeUndefined();
  expect(defaults.generated?.fogOfWar).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/conquest/model.test.ts src/conquest/generate.test.ts` Expected: FAIL — type error on the `generated` literal / missing knobs in output.

- [ ] **Step 3: Extend the schema in `model.ts`**

Replace the `generated` field of `GalaxyDoc` (line 133-134):

```ts
  /**
   * Present on procedurally generated docs; carries the generation knobs so
   * the galaxy can be rerolled in place. Maps, AIs and naming pools are
   * deliberately not stored — they re-resolve from installed content and the
   * current profile/branding at reroll time.
   */
  generated?: {
    seed: number;
    nodeCount?: number;
    factionCount?: number;
    layout?: "scatter" | "spiral" | "clusters" | "ring" | "random";
    skin?: "galaxy" | "theatre";
    startingSystems?: number;
    fogOfWar?: boolean;
  };
```

Add a parser next to `parseTheme` (clamps mirror `generateGalaxy`'s):

```ts
function parseGenerated(value: unknown): GalaxyDoc["generated"] {
  if (typeof value !== "object" || value === null) return undefined;
  const g = value as Record<string, unknown>;
  if (typeof g.seed !== "number" || !Number.isFinite(g.seed)) return undefined;
  return {
    seed: g.seed,
    nodeCount:
      typeof g.nodeCount === "number" && Number.isFinite(g.nodeCount)
        ? clamp(Math.round(g.nodeCount), 8, 80)
        : undefined,
    factionCount:
      typeof g.factionCount === "number" && Number.isFinite(g.factionCount)
        ? clamp(Math.round(g.factionCount), 1, 3)
        : undefined,
    layout:
      g.layout === "scatter" ||
      g.layout === "spiral" ||
      g.layout === "clusters" ||
      g.layout === "ring" ||
      g.layout === "random"
        ? g.layout
        : undefined,
    skin: g.skin === "galaxy" || g.skin === "theatre" ? g.skin : undefined,
    startingSystems:
      typeof g.startingSystems === "number" &&
      Number.isFinite(g.startingSystems)
        ? clamp(Math.round(g.startingSystems), 1, 4)
        : undefined,
    fogOfWar: g.fogOfWar === true ? true : undefined,
  };
}
```

In `parseGalaxyJson`, delete the `const generated = ...` local (line 425) and replace the `generated:` entry in the return object (lines 452-458) with:

```ts
    generated: parseGenerated(d.generated),
```

- [ ] **Step 4: Write the knobs in `generateGalaxy`**

In `src/conquest/generate.ts`, replace `generated: { seed: opts.seed },` (line 419) with the clamped values already computed in scope (`nodeCount`, `enemyCount`, `startCount`):

```ts
    generated: {
      seed: opts.seed,
      nodeCount,
      factionCount: enemyCount,
      layout: opts.layout ?? "scatter",
      skin: opts.skin === "theatre" ? "theatre" : "galaxy",
      startingSystems: startCount,
      fogOfWar: opts.fogOfWar ? true : undefined,
    },
```

- [ ] **Step 5: Run the full conquest suite**

Run: `bun run test src/conquest` Expected: PASS — including the pre-existing "survives its own validator" round-trip, which now exercises the new fields.

- [ ] **Step 6: Commit**

```bash
git add src/conquest/model.ts src/conquest/model.test.ts src/conquest/generate.ts src/conquest/generate.test.ts
git commit -m "feat(conquest): persist generation knobs on generated galaxies"
```

---

### Task 5: `regenerateGalaxy` helper

**Files:**
- Modify: `src/conquest/generate.ts` (new export after `generateGalaxy`)
- Test: `src/conquest/generate.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `src/conquest/generate.test.ts` (import `regenerateGalaxy` alongside `generateGalaxy`):

```ts
describe("regenerateGalaxy", () => {
  it("rerolls in place: same id/title/createdAt/knobs, new positions", () => {
    const doc = generateGalaxy({ ...base, id: "keep-id", title: "Keep" }, "t0");
    const re = regenerateGalaxy(doc, { maps, ais }, 999, "t1");
    expect(re).not.toBeNull();
    expect(re?.id).toBe("keep-id");
    expect(re?.title).toBe("Keep");
    expect(re?.createdAt).toBe("t0");
    expect(re?.updatedAt).toBe("t1");
    expect(re?.generated?.seed).toBe(999);
    expect(re?.generated?.nodeCount).toBe(16);
    expect(re?.nodes.map((n) => n.pos)).not.toEqual(doc.nodes.map((n) => n.pos));
  });

  it("returns null for docs without persisted knobs", () => {
    const doc = generateGalaxy(base, "t0");
    const legacy = { ...doc, generated: { seed: 1 } };
    expect(regenerateGalaxy(legacy, { maps, ais }, 5, "t1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/conquest/generate.test.ts` Expected: FAIL — `regenerateGalaxy` is not exported.

- [ ] **Step 3: Implement**

In `src/conquest/generate.ts`, after `generateGalaxy`:

```ts
/** The content environment a reroll resolves at call time (never persisted). */
export interface RegenerateEnv {
  maps: GenMap[];
  ais: GenAi[];
  names?: ConquestNames;
}

/**
 * Reroll a generated galaxy in place: same id, title and generation knobs,
 * new seed, content environment re-resolved by the caller. Returns null for
 * docs without persisted knobs (authored galaxies, or generated ones saved
 * before the knobs existed).
 */
export function regenerateGalaxy(
  galaxy: GalaxyDoc,
  env: RegenerateEnv,
  seed: number,
  now: string = new Date().toISOString(),
): GalaxyDoc | null {
  const g = galaxy.generated;
  if (!g || g.nodeCount === undefined || g.factionCount === undefined) {
    return null;
  }
  const doc = generateGalaxy(
    {
      seed,
      game: { shortname: galaxy.game.shortname },
      maps: env.maps,
      ais: env.ais,
      nodeCount: g.nodeCount,
      factionCount: g.factionCount,
      layout: g.layout,
      skin: g.skin,
      startingSystems: g.startingSystems,
      fogOfWar: g.fogOfWar,
      names: env.names,
      id: galaxy.id,
      title: galaxy.title,
    },
    now,
  );
  return { ...doc, createdAt: galaxy.createdAt };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test src/conquest/generate.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conquest/generate.ts src/conquest/generate.test.ts
git commit -m "feat(conquest): regenerateGalaxy rerolls a doc from persisted knobs"
```

---

### Task 6: Regenerate button on the galaxy page

**Files:**
- Modify: `src/conquest/pages/GalaxyPage.tsx` (imports + `RunSetupPanel`, lines 388-464)

No unit test (React wiring over Tauri hooks; no component-test precedent in this repo). Verified by typecheck and live smoke in Task 8.

- [ ] **Step 1: Add imports**

In `src/conquest/pages/GalaxyPage.tsx`, extend the lucide import (line 2) with `Dices`, and add:

```ts
import { resolveBranding, useBrandingCatalog } from "../../content/branding";
import { getProfile } from "../../profile/profile";
import { conquestSave } from "../bindings";
import { refreshGalaxies } from "../conquests";
import { regenerateGalaxy } from "../generate";
import { mergeConquestNames } from "../names";
```

(`useSkirmishAis` joins the existing `usePreferredTarget` import from `../../play/config`; `useConquestState`/`useGalaxies` already come from `../conquests` — merge, don't duplicate.)

- [ ] **Step 2: Wire regeneration into `RunSetupPanel`**

`RunSetupPanel` already has `target`, `scan` and `installedGame`. After the `installedGame` line (~line 411), add:

```tsx
  const { ais } = useSkirmishAis(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  const brandingEntries = useBrandingCatalog();
  const brandingEntry = installedGame
    ? resolveBranding(brandingEntries, installedGame)
    : null;
  const canRegenerate =
    galaxy.generated?.nodeCount !== undefined &&
    galaxy.generated?.factionCount !== undefined;
  const [regenBusy, setRegenBusy] = useState(false);
  const regenerate = async () => {
    const maps = scan.data?.maps ?? [];
    if (maps.length === 0) return;
    setRegenBusy(true);
    try {
      const doc = regenerateGalaxy(
        galaxy,
        {
          maps,
          ais: ais.map((a) => ({
            kind: a.kind,
            shortName: a.shortName,
            name: a.name,
          })),
          names: mergeConquestNames(
            getProfile().conquest,
            brandingEntry?.conquest,
          ),
        },
        Math.floor(Math.random() * 100000),
      );
      if (!doc) return;
      await conquestSave({ id: doc.id, json: JSON.stringify(doc) });
      await refreshGalaxies();
    } finally {
      setRegenBusy(false);
    }
  };
```

- [ ] **Step 3: Add the button**

In `RunSetupPanel`'s JSX, directly before the Start button (line 449), add:

```tsx
      {canRegenerate && (
        <Button
          variant="outline"
          disabled={regenBusy || busy || !scan.data}
          onClick={regenerate}
        >
          <Dices className="mr-1.5 size-4" aria-hidden />
          {regenBusy ? "Regenerating…" : "Regenerate galaxy"}
        </Button>
      )}
```

The saved doc flows back through `refreshGalaxies` → `useGalaxies` → the `galaxy` prop; the page `key` is the (unchanged) galaxy id, so `GalaxyView` rebuilds with the new nodes in place.

- [ ] **Step 4: Typecheck + lint**

Run: `bun run typecheck && bunx biome ci src/conquest/pages/GalaxyPage.tsx` Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/conquest/pages/GalaxyPage.tsx
git commit -m "feat(conquest): regenerate button on the pre-run galaxy page"
```

---

### Task 7: 2D preview in the create wizard

**Files:**
- Create: `src/conquest/pages/components/GalaxyPreview2D.tsx`
- Modify: `src/conquest/pages/ConquestListPage.tsx` (`GenerateGalaxyForm`, lines 362-501)

- [ ] **Step 1: Create the preview component**

`src/conquest/pages/components/GalaxyPreview2D.tsx`:

```tsx
import { useMemo } from "react";
import type { GalaxyDoc } from "../../model";
import { NEUTRAL } from "../../model";

/**
 * A cheap 2D constellation preview of a galaxy document: authored node
 * positions, lanes and capitals in faction colours, drawn straight in the
 * authored coordinate space. Pure SVG — the wizard regenerates this on every
 * knob change, which would be wasteful with the three.js view.
 */
export function GalaxyPreview2D({ galaxy }: { galaxy: GalaxyDoc }) {
  const view = useMemo(() => {
    const xs = galaxy.nodes.map((n) => n.pos[0]);
    const ys = galaxy.nodes.map((n) => n.pos[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const pad = span * 0.08;
    const byId = new Map(galaxy.nodes.map((n) => [n.id, n]));
    const color = new Map(galaxy.factions.map((f) => [f.id, f.color]));
    return {
      box: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
      r: span * 0.014,
      lanes: galaxy.links.flatMap(([a, b]) => {
        const na = byId.get(a);
        const nb = byId.get(b);
        return na && nb
          ? [
              {
                key: `${a}:${b}`,
                x1: na.pos[0],
                y1: na.pos[1],
                x2: nb.pos[0],
                y2: nb.pos[1],
              },
            ]
          : [];
      }),
      stars: galaxy.nodes.map((n) => ({
        id: n.id,
        x: n.pos[0],
        y: n.pos[1],
        capital: n.kind === "capital",
        color:
          n.owner === NEUTRAL ? "#94a3b8" : (color.get(n.owner) ?? "#94a3b8"),
      })),
    };
  }, [galaxy]);

  return (
    <svg
      viewBox={view.box}
      className="aspect-square w-full rounded-md border border-border/50 bg-[#05070f]"
      role="img"
      aria-label="Galaxy layout preview"
    >
      {view.lanes.map((l) => (
        <line
          key={l.key}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke="#334155"
          strokeWidth={view.r * 0.3}
        />
      ))}
      {view.stars.map((s) => (
        <circle
          key={s.id}
          cx={s.x}
          cy={s.y}
          r={s.capital ? view.r * 1.9 : view.r}
          fill={s.color}
          stroke={s.capital ? "#e2e8f0" : "none"}
          strokeWidth={s.capital ? view.r * 0.35 : 0}
        />
      ))}
    </svg>
  );
}
```

- [ ] **Step 2: Share option-building in the wizard and generate the preview**

In `GenerateGalaxyForm` (`ConquestListPage.tsx`), add imports: `useCallback` to the react import (line 3), `type GenerateOptions` to the generate import (line 18), and `import { GalaxyPreview2D } from "./components/GalaxyPreview2D";`.

After the `seed` state (line 344), add a shared options builder and the preview doc:

```tsx
  const genOptions = useCallback(
    (id: string): GenerateOptions => ({
      seed: Number(seed) || 1,
      game: { shortname: effectiveShort },
      maps,
      ais: ais.map((a) => ({
        kind: a.kind,
        shortName: a.shortName,
        name: a.name,
      })),
      nodeCount: Number(size),
      factionCount: Number(factions),
      layout: layout as GenerateOptions["layout"],
      skin: style === "theatre" ? "theatre" : "galaxy",
      startingSystems: starting ? Number(starting) : undefined,
      fogOfWar: fog,
      names,
      id,
      title: `${effectiveShort} Conquest`,
    }),
    [seed, effectiveShort, maps, ais, size, factions, layout, style, starting, fog, names],
  );

  const preview = useMemo(() => {
    if (!selected || maps.length === 0) return null;
    try {
      return generateGalaxy(genOptions("preview"));
    } catch {
      return null;
    }
  }, [genOptions, selected, maps.length]);
```

Note: `maps` is defined at line 351 (`const maps = scan.data?.maps ?? [];`) — move that line up so it sits above `genOptions` (it must be declared before use). `ais` (line 320) and `names` (line 331) already are.

In `create` (line 362), replace the inline options object so both paths share one builder:

```tsx
      const id = `generated-${crypto.randomUUID()}`;
      const doc = generateGalaxy(genOptions(id));
```

(The `seed`, `game`, `maps`, `ais`, ..., `title` lines of the old inline object are deleted.)

- [ ] **Step 3: Render the preview under the seed row**

After the seed `div` (closes line 493), before `{error && ...}`:

```tsx
          {preview && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Preview</span>
              <GalaxyPreview2D galaxy={preview} />
            </div>
          )}
```

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bunx biome ci . && bun run test src/conquest` Expected: all clean/passing.

- [ ] **Step 5: Commit**

```bash
git add src/conquest/pages/components/GalaxyPreview2D.tsx src/conquest/pages/ConquestListPage.tsx
git commit -m "feat(conquest): live 2D galaxy preview in the create wizard"
```

---

### Task 8: Full verification + live smoke gate

- [ ] **Step 1: Full frontend suite**

Run: `bun run test && bunx biome ci . && bun run typecheck` Expected: all pass. Fix anything that fails before continuing.

- [ ] **Step 2: Rust suite (CI runs it even for frontend-only changes)**

Run: `cargo fmt --all --check && cargo clippy --all-targets --all-features -- -D warnings` Note: clippy compiles the Tauri app crate; if it complains about a missing unitsync sidecar binary, run `bun run sidecar:unitsync` first. Expected: clean (no Rust was touched).

- [ ] **Step 3: STOP — user live test**

Per project CLAUDE.md, give the user the opportunity to test via `bun tauri dev` before any PR:
- Wizard: preview appears, changes with size/shape/seed, dice reroll visibly rerolls.
- Galaxy page: Regenerate button on the Begin conquest panel rerolls stars in place; absent on a started run and on pre-knob galaxies.
- Density: an 80-system galaxy visibly roomier than before; 18-system unchanged.
- Spacing: scatter shows tight pairs and gaps rather than a uniform carpet.

Report status honestly (what was verified vs not) and wait for the user's verdict before drafting a PR description (which itself needs user approval before `gh pr create`).
