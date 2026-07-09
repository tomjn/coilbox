# Conquest Voidwater Asteroid/Comet Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conquest nodes whose battle map is a space map (`voidWater`) render as asteroid fields (rare comet variant) instead of star systems, driven by an opportunistic map-appearance cache populated from the minimap the app already renders.

**Architecture:** A persistent frontend cache stores each map's `MapAppearance` (reusing the mapconv type), written at the single shared `useUnitsyncMinimap` call site. `GalaxyView` derives a node's body at render time from whether its `battle.mapName` is a known space map — no generator, schema, or Rust change.

**Tech Stack:** TypeScript + React, three.js, vitest. `useSetting` (frame settings store) for persistence.

**Spec:** `docs/superpowers/specs/2026-07-09-conquest-voidwater-nodes-design.md`

**Conventions:** run tests with `bun run test`. Commit after each task; no emoji, no AI attribution, don't change git user. Confirm `git branch --show-current` is `t3code/conquest-voidwater-nodes` before each commit, don't switch branches. Clippy locally needs `bun run sidecar:unitsync` plus empty `src-tauri/mapconv` and `src-tauri/prdownloader` dirs (CI creates them). The three.js sprite work in Task 5 cannot be unit-tested (no WebGL in jsdom) — it is typecheck-gated and tuned live in Task 6.

---

### Task 1: Map-appearance cache module

**Files:**
- Create: `src/content/mapAppearanceCache.ts`
- Test: `src/content/mapAppearanceCache.test.ts`

- [ ] **Step 1: Write the failing test**

`src/content/mapAppearanceCache.test.ts` (pure selector only — the hooks wrap `useSetting` and are exercised live):

```ts
import { describe, expect, it } from "vitest";
import { spaceMapNames } from "./mapAppearanceCache";

describe("spaceMapNames", () => {
  it("returns only maps whose appearance has voidWater === true", () => {
    const set = spaceMapNames({
      "Nova Rift": { voidWater: true },
      "Green Valley": { voidWater: false },
      "Old Map": { voidWater: null },
      "Unknown": {},
    });
    expect(set.has("Nova Rift")).toBe(true);
    expect(set.has("Green Valley")).toBe(false);
    expect(set.has("Old Map")).toBe(false);
    expect(set.has("Unknown")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("is empty for an empty cache", () => {
    expect(spaceMapNames({}).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/content/mapAppearanceCache.test.ts`
Expected: FAIL — module/`spaceMapNames` not found.

- [ ] **Step 3: Implement the module**

`src/content/mapAppearanceCache.ts`:

```ts
import { useSetting } from "@picoframe/frame";
import { useCallback, useMemo, useRef } from "react";
import type { MapAppearance } from "../mapconv/bindings";

/**
 * Opportunistic, persistent cache of per-map `MapAppearance`, keyed by map
 * spring-name. Populated as a side effect of the minimap the app already
 * renders (see `useRecordMapAppearance`, wired into `useUnitsyncMinimap`), so
 * it never mounts an archive of its own. Best-effort: a map whose minimap has
 * never been resolved is simply absent. Stores the whole appearance record so
 * future features (wind, tidal, water colours) reuse it, not just `voidWater`.
 */
const MAP_APPEARANCE_KEY = "content.mapAppearance";

type Cache = Record<string, MapAppearance>;

/** Names in the cache that are space maps (`voidWater === true`). Pure. */
export function spaceMapNames(cache: Cache): Set<string> {
  const out = new Set<string>();
  for (const [name, app] of Object.entries(cache)) {
    if (app?.voidWater === true) out.add(name);
  }
  return out;
}

/** The raw cache record (reactive). */
export function useMapAppearanceCache(): Cache {
  const [cache] = useSetting<Cache>(MAP_APPEARANCE_KEY, {});
  return cache;
}

/** The set of known space-map names (reactive). */
export function useKnownSpaceMaps(): Set<string> {
  const cache = useMapAppearanceCache();
  return useMemo(() => spaceMapNames(cache), [cache]);
}

/**
 * A stable recorder that banks a map's appearance. Uses a ref for the current
 * cache so the returned callback never goes stale and callers need not depend
 * on the cache. A no-op when the entry is already present (we only learn more
 * by re-resolving, which we don't do), so repeat views don't rewrite settings.
 */
export function useRecordMapAppearance(): (
  name: string,
  appearance: MapAppearance,
) => void {
  const [cache, setCache] = useSetting<Cache>(MAP_APPEARANCE_KEY, {});
  const ref = useRef(cache);
  ref.current = cache;
  return useCallback(
    (name, appearance) => {
      if (ref.current[name]) return;
      setCache({ ...ref.current, [name]: appearance });
    },
    [setCache],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/content/mapAppearanceCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/mapAppearanceCache.ts src/content/mapAppearanceCache.test.ts
git commit -m "feat(content): opportunistic per-map appearance cache"
```

---

### Task 2: Populate the cache from the shared minimap hook

**Files:**
- Modify: `src/content/config.ts` (`useUnitsyncMinimap`, lines 991-1065)

No unit test (React hook over Tauri IO). Verified by typecheck + the cache filling in live smoke.

- [ ] **Step 1: Import the recorder**

Add near the top of `src/content/config.ts` (with the other local imports):

```ts
import { useRecordMapAppearance } from "./mapAppearanceCache";
```

- [ ] **Step 2: Record the appearance when a minimap resolves**

Inside `useUnitsyncMinimap`, add the recorder hook alongside the existing state (e.g. after `const [error, setError] = useState<string | null>(null);`, line 1007):

```ts
  const recordAppearance = useRecordMapAppearance();
```

The `apply` callback (lines 1018-1049) already builds an `appearance` object. Capture it into a local and record it. Change the `setAppearance({...})` call so the object is named first:

```ts
      const appearance: MapAppearance = {
        voidWater: res.voidWater,
        voidGround: res.voidGround,
        voidAlphaMin: res.voidAlphaMin,
        waterColor: res.waterColor,
        waterAlpha: res.waterAlpha,
        waterPlaneColor: res.waterPlaneColor,
        waterAbsorb: res.waterAbsorb,
        waterBaseColor: res.waterBaseColor,
        waterMinColor: res.waterMinColor,
        forceRendering: res.forceRendering,
        skyColor: res.skyColor,
        fogColor: res.fogColor,
        cloudColor: res.cloudColor,
        cloudDensity: res.cloudDensity,
        sunDir: res.sunDir,
        sunColor: res.sunColor,
        groundAmbientColor: res.groundAmbientColor,
        groundDiffuseColor: res.groundDiffuseColor,
        groundSpecularColor: res.groundSpecularColor,
        groundShadowDensity: res.groundShadowDensity,
      };
      setAppearance(appearance);
      if (mapName) recordAppearance(mapName, appearance);
```

(The field list is unchanged from the current `setAppearance` argument — only extracted to a named const and passed to `recordAppearance`. `mapName` is in scope from the hook args.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/content/config.ts
git commit -m "feat(content): bank map appearance whenever a minimap resolves"
```

---

### Task 3: Pure node-body helpers

**Files:**
- Create: `src/conquest/galaxy3d/bodies.ts`
- Test: `src/conquest/galaxy3d/bodies.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/conquest/galaxy3d/bodies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bodyLabel, voidBodyFor } from "./bodies";

describe("voidBodyFor", () => {
  it("is deterministic per node id", () => {
    expect(voidBodyFor("node-3")).toBe(voidBodyFor("node-3"));
  });

  it("yields mostly asteroids with a rare comet minority", () => {
    const kinds = Array.from({ length: 200 }, (_, i) => voidBodyFor(`node-${i}`));
    const comets = kinds.filter((k) => k === "comet").length;
    const asteroids = kinds.filter((k) => k === "asteroid").length;
    expect(comets).toBeGreaterThan(0);
    expect(asteroids).toBeGreaterThan(comets);
    expect(comets + asteroids).toBe(200);
  });
});

describe("bodyLabel", () => {
  it("labels void bodies", () => {
    expect(bodyLabel("comet")).toBe("comet");
    expect(bodyLabel("asteroid")).toBe("asteroid field");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/conquest/galaxy3d/bodies.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/conquest/galaxy3d/bodies.ts`:

```ts
import { hashString } from "./layout";

/** A node's non-stellar body when it sits on a voidwater (space) map. */
export type VoidBody = "asteroid" | "comet";

/**
 * The void body for a node: an asteroid field, or a comet for roughly one node
 * in seven (deterministic hash of the id, same approach as the stellar class /
 * binary derivation). Comets stay rare so they read as special.
 */
export function voidBodyFor(nodeId: string): VoidBody {
  return hashString(`${nodeId}-void`) % 7 === 0 ? "comet" : "asteroid";
}

/** Selection-panel label for a void body. */
export function bodyLabel(body: VoidBody): string {
  return body === "comet" ? "comet" : "asteroid field";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test src/conquest/galaxy3d/bodies.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conquest/galaxy3d/bodies.ts src/conquest/galaxy3d/bodies.test.ts
git commit -m "feat(conquest): pure asteroid/comet body derivation"
```

---

### Task 4: Asteroid and comet-tail textures

**Files:**
- Modify: `src/conquest/galaxy3d/textures.ts` (add two exported functions)

No unit test (canvas rendering; jsdom has no 2D context). Typecheck-gated, tuned live.

- [ ] **Step 1: Add the textures**

Append to `src/conquest/galaxy3d/textures.ts`:

```ts
/**
 * A rough rocky blob for asteroid-field nodes: an off-centre lumpy mass with a
 * soft edge, computed per-pixel (dither-free like the star textures). Greyscale
 * — the sprite material tints it. First cut; tune the lump field by eye.
 */
export function asteroidTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    // A few fixed lumps (deterministic — no RNG) that union into a cluster.
    const lumps = [
      [0.0, 0.0, 0.34],
      [0.26, -0.14, 0.2],
      [-0.22, 0.2, 0.17],
      [0.12, 0.28, 0.13],
    ] as const;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5 - half) / half;
        const ny = (y + 0.5 - half) / half;
        let cover = 0;
        for (const [lx, ly, lr] of lumps) {
          const d = Math.hypot(nx - lx, ny - ly);
          cover = Math.max(cover, 1 - d / lr);
        }
        const a = Math.max(0, Math.min(1, cover));
        // Soft shaded rock: brighter toward the upper-left "lit" side.
        const shade = 0.55 + 0.45 * Math.max(0, -nx * 0.6 - ny * 0.6);
        const v = Math.round(shade * 255);
        const o = (y * size + x) * 4;
        img.data[o] = v;
        img.data[o + 1] = v;
        img.data[o + 2] = v;
        img.data[o + 3] = Math.round(a ** 0.7 * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A comet tail: a soft teardrop that fades along +x, so a sprite rotated by the
 * node hash streaks away from the head. Greyscale; the material tints it.
 */
export function cometTailTexture(size: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5 - half) / half; // -1..1 along the tail
        const ny = (y + 0.5 - half) / half;
        // Head at nx=-1, fading to nothing at nx=1; narrows toward the tip.
        const along = Math.max(0, Math.min(1, (nx + 1) / 2));
        const width = 0.5 * (1 - along) + 0.05;
        const across = Math.exp(-(ny * ny) / (2 * width * width));
        const a = across * (1 - along) ** 1.5;
        const o = (y * size + x) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/conquest/galaxy3d/textures.ts
git commit -m "feat(conquest): asteroid and comet-tail canvas textures"
```

---

### Task 5: Render void bodies in GalaxyView + wire GalaxyPage

**Files:**
- Modify: `src/conquest/galaxy3d/GalaxyView.tsx` (props, texture setup, node loop, label export, effect deps)
- Modify: `src/conquest/pages/GalaxyPage.tsx` (pass `spaceMaps`, void label in SelectionPanel)

No unit test (WebGL). Typecheck-gated; tuned in Task 6.

- [ ] **Step 1: Add the `spaceMaps` prop**

In `src/conquest/galaxy3d/GalaxyView.tsx`, add to `GalaxyViewProps` (near the other optional props like `visibleIds`):

```ts
  /** Map spring-names known to be space maps; their nodes render as asteroids. */
  spaceMaps?: Set<string>;
```

Destructure it in the `GalaxyView({ ... })` parameter list (add `spaceMaps,` beside `visibleIds,`).

- [ ] **Step 2: Import the body helpers and add textures**

Update the textures import (line 15):

```ts
import {
  asteroidTexture,
  cometTailTexture,
  radialTexture,
  spikesTexture,
} from "./textures";
```

Add the body-helper import near the other local imports:

```ts
import { voidBodyFor } from "./bodies";
```

After the star textures are created (line 854-855), add the void textures and register them for disposal:

```ts
    const asteroidTex = asteroidTexture(128);
    const cometTailTex = cometTailTexture(256);
    disposables.push(starTex, coronaTex, spikeTex, asteroidTex, cometTailTex);
```

(Replace the existing `disposables.push(starTex, coronaTex, spikeTex);` on line 855 with the line above.)

- [ ] **Step 3: Branch the node loop for void bodies**

In the `galaxy.nodes.forEach((n, i) => { ... })` loop, after the `theatre` block returns and before the stellar `const type = nodeType[i];` (line 970), insert a void branch. It reuses the `starSprites`/`starMats`/`coronaSprites`/`spikeSprites`/`ownerRings` slots (so intro animation, ownership rings and selection all keep working) but draws rock instead of a star and skips the binary companion:

```ts
      const isVoid = !!spaceMaps?.has(n.battle.mapName);
      if (isVoid) {
        discMats.push(undefined);
        const body = voidBodyFor(n.id);
        // Muted rock, no stellar tint-to-white and no diffraction spikes.
        const rockColor = new THREE.Color("#8a8079");
        const starMat = new THREE.SpriteMaterial({
          map: asteroidTex,
          color: rockColor,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          rotation: ((hashString(`${n.id}-rock`) % 100) / 100) * Math.PI * 2,
        });
        const star = new THREE.Sprite(starMat);
        star.position.set(p[0], p[1], p[2]);
        registerIntro(star, starScale(i) * 0.8, n.id);
        star.raycast = () => {};
        // A faint dust halo instead of a stellar corona.
        const coronaMat = new THREE.SpriteMaterial({
          map: coronaTex,
          color: new THREE.Color("#4a5468"),
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const corona = new THREE.Sprite(coronaMat);
        corona.position.set(p[0], p[1], p[2]);
        registerIntro(corona, coronaScale(i, false) * 0.6, `${n.id}-corona`);
        corona.raycast = () => {};
        // Comet: a tail streaking away from the head at a per-node angle.
        let spikes: THREE.Sprite | undefined;
        if (body === "comet") {
          const tailMat = new THREE.SpriteMaterial({
            map: cometTailTex,
            color: new THREE.Color("#bfe0ff"),
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            rotation: ((hashString(`${n.id}-tail`) % 100) / 100) * Math.PI * 2,
          });
          spikes = new THREE.Sprite(tailMat);
          spikes.center.set(0.85, 0.5); // pivot near the head so it trails out
          spikes.position.set(p[0], p[1], p[2]);
          registerIntro(spikes, starScale(i) * 2.6, `${n.id}-tail`);
          spikes.raycast = () => {};
          disposables.push(tailMat);
          scene.add(spikes);
        }
        const ringMat = new THREE.MeshBasicMaterial({
          color: ownerColor(ownersRef.current[n.id] ?? n.owner),
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeoFor(0), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p[0], p[1] - 0.4, p[2]);
        ring.raycast = () => {};
        starSprites.push(star);
        starMats.push(starMat);
        spikeSprites.push(spikes);
        coronaSprites.push(corona);
        ownerRingMats.push(ringMat);
        ownerRings.push(ring);
        disposables.push(starMat, coronaMat, ringMat);
        scene.add(star, corona, ring);
        return;
      }
```

(The existing stellar body code below is unchanged and runs for non-void nodes.)

- [ ] **Step 4: Void-aware selection label**

`starSystemLabel` is imported by `GalaxyPage`. Rather than change its signature, add a small exported helper next to it in `GalaxyView.tsx` (after `starSystemLabel`, line 137):

```ts
/** Selection-panel label for a node, accounting for a voidwater body. */
export function nodeBodyLabel(nodeId: string, isVoid: boolean): string | null {
  if (isVoid) return bodyLabel(voidBodyFor(nodeId));
  return starSystemLabel(starSystemFor(nodeId, false));
}
```

Import `bodyLabel` alongside `voidBodyFor` from `./bodies`.

- [ ] **Step 5: Add `spaceMaps` to the rebuild deps**

The main build effect ends at line 1733: `}, [galaxy, playerFactionId, reduceMotion, effects, performanceMode]);`. Add `spaceMaps` so the scene rebuilds when the cache first learns a map is void:

```ts
  }, [galaxy, playerFactionId, reduceMotion, effects, performanceMode, spaceMaps]);
```

- [ ] **Step 6: Wire GalaxyPage**

In `src/conquest/pages/GalaxyPage.tsx`:

Import the cache hook and the label helper:

```ts
import { useKnownSpaceMaps } from "../../content/mapAppearanceCache";
```

Add `nodeBodyLabel` to the existing import from `../galaxy3d/GalaxyView` (alongside `GalaxyView`, `starSystemFor`, `starSystemLabel`).

In `GalaxyScreen`, resolve the set and pass it to `GalaxyView`:

```ts
  const spaceMaps = useKnownSpaceMaps();
```

Add the prop to the `<GalaxyView ... />` element (beside `visibleIds={visibleIds}`):

```tsx
        spaceMaps={spaceMaps}
```

`SelectionPanel` (line 307) needs to know if the selected node is void. It's rendered inside `GalaxyScreen` where `spaceMaps` is in scope — pass it down: add `spaceMaps` to the `SelectionPanel` props type and the call site, then replace the stellar label line (around line 342):

```tsx
          {galaxy.theme?.skin !== "theatre" && (
            <span className="text-xs capitalize text-muted-foreground/70">
              {nodeBodyLabel(node.id, spaceMaps.has(node.battle.mapName))}
            </span>
          )}
```

- [ ] **Step 7: Typecheck + lint**

Run: `bun run typecheck && bunx biome ci src/conquest src/content`
Expected: clean (0 errors; repo-wide pre-existing warnings are not these files).

- [ ] **Step 8: Commit**

```bash
git add src/conquest/galaxy3d/GalaxyView.tsx src/conquest/pages/GalaxyPage.tsx
git commit -m "feat(conquest): render asteroid/comet bodies on space-map nodes"
```

---

### Task 6: Full verification + live smoke gate

- [ ] **Step 1: Full frontend suite**

Run: `bun run test && bunx biome ci . && bun run typecheck`
Expected: all pass. Fix anything that fails.

- [ ] **Step 2: Rust suite (CI runs it regardless)**

Run: `cargo fmt --all --check && cargo clippy --all-targets --all-features -- -D warnings`
If clippy fails on a missing sidecar/resource: `bun run sidecar:unitsync`, then `mkdir -p src-tauri/mapconv src-tauri/prdownloader`, and re-run.
Expected: clean (no Rust touched).

- [ ] **Step 3: STOP — user live test**

Per project CLAUDE.md, offer `bun tauri dev` before any PR. This feature needs visual iteration:
- Open a space map's minimap first (Content > Maps, or the play map picker) so its appearance is cached.
- Open/generate a conquest galaxy whose maps include that space map: its nodes render as asteroid fields, ~1 in 7 as comets with a trailing tail; ownership rings and selection still work; the selection panel says "asteroid field" / "comet".
- A galaxy with no known space maps is visually unchanged.
- Confirm the asteroid/comet look is acceptable and tune `asteroidTexture` / `cometTailTexture` / the sprite colours and scales by eye if needed (commit tweaks separately).
- Check the scene doesn't visibly re-run its intro when the cache updates mid-view (spaceMaps in the rebuild deps); if it does and it's jarring, gate the rebuild.

Report status honestly (verified vs not). Then draft the PR description for user approval before `gh pr create`.
