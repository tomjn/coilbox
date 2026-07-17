# Conquest Name Fallback + Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a themed star-name pool is exhausted, extend it on-theme with roman numerals before inventing names; and let a distribution cap the galaxy to its named-star count with `limitToNamed`, disabling all fallback.

**Architecture:** The naming tier order lives in `makeStarNamer` (add a numeral tier before syllable synthesis). The cap is a `ConquestNames` flag that reaches `generateGalaxy` via `resolveConquestNames` and lowers `nodeCount`. The wizard derives a caption from the (already-capped) preview.

**Tech Stack:** TypeScript + React (Tauri frontend), vitest. No Rust changes.

**Spec:** `docs/superpowers/specs/2026-07-09-conquest-name-fallback-cap-design.md`

**Conventions:** run tests with `bun run test`. Commit after each task; no emoji, no AI attribution, don't change git user. Verify `git branch --show-current` is `t3code/conquest-name-fallback-cap` before each commit but do not switch branches. Clippy locally needs `bun run sidecar:unitsync` plus empty `src-tauri/mapconv` and `src-tauri/prdownloader` dirs (CI creates them).

---

### Task 1: Themed numeral fallback in the star namer

**Files:**
- Modify: `src/conquest/names.ts` (new `toRoman`, `makeStarNamer` at line 288)
- Test: `src/conquest/names.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/conquest/names.test.ts` inside the `makeStarNamer` describe block:

```ts
  it("extends an exhausted pool with roman numerals before synthesis", () => {
    const names = resolveConquestNames({ starNames: ["Vega", "Altair"] });
    const namer = makeStarNamer(mulberry32(1), names);
    const used = new Set<string>();
    const out = Array.from({ length: 6 }, () => namer(used));
    expect(new Set(out).size).toBe(6);
    // Two base names, then the same two with II, then III — never invented.
    expect(out).toEqual(
      expect.arrayContaining([
        "Vega",
        "Altair",
        "Vega II",
        "Altair II",
        "Vega III",
        "Altair III",
      ]),
    );
  });

  it("falls back to synthesis only when the pool is empty", () => {
    const names = resolveConquestNames({
      starNames: [],
      starPrefixes: ["Xo"],
      starSuffixes: ["ra"],
    });
    // resolveConquestNames refills starNames from the built-ins, so force empty.
    const namer = makeStarNamer(mulberry32(1), { ...names, starNames: [] });
    const used = new Set<string>();
    const out = Array.from({ length: 3 }, () => namer(used));
    for (const n of out) expect(n.startsWith("Xora")).toBe(true);
  });
```

And a new top-level describe block (import `toRoman` in the existing import from `./names`):

```ts
describe("toRoman", () => {
  it("converts the numerals we actually use", () => {
    expect(toRoman(2)).toBe("II");
    expect(toRoman(3)).toBe("III");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(9)).toBe("IX");
    expect(toRoman(40)).toBe("XL");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/conquest/names.test.ts` Expected: FAIL — `toRoman` not exported; the numeral test gets synthesized names, not `Vega II`.

- [ ] **Step 3: Implement**

In `src/conquest/names.ts`, add before `makeStarNamer`:

```ts
/** Roman numeral for n (n >= 1); used to extend a name pool on-theme. */
export function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  let rem = Math.max(1, Math.floor(n));
  for (const [value, sym] of table) {
    while (rem >= value) {
      out += sym;
      rem -= value;
    }
  }
  return out;
}
```

Replace the returned closure body of `makeStarNamer` (lines 294-310) so the numeral tier sits between the pool and synthesis:

```ts
  return (used: Set<string>): string => {
    while (poolIdx < pool.length) {
      const name = pool[poolIdx++];
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    // On-theme overflow: reuse the pool with roman numerals (Vega II, ...),
    // in pool order per numeral. Never runs out, so synthesis below is reached
    // only when there is no pool at all.
    if (pool.length > 0) {
      for (let numeral = 2; ; numeral++) {
        const suffix = toRoman(numeral);
        for (const base of pool) {
          const name = `${base} ${suffix}`;
          if (!used.has(name)) {
            used.add(name);
            return name;
          }
        }
      }
    }
    for (let attempt = 0; ; attempt++) {
      let name = pick(rng, names.starPrefixes) + pick(rng, names.starSuffixes);
      if (attempt > 8) name = `${name} ${Math.floor(rng() * 90) + 10}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  };
```

Update the `makeStarNamer` doc comment's "then synthesizing" clause to mention the numeral tier: "then extending the pool with roman numerals, then synthesizing ... as a last resort".

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test src/conquest/names.test.ts` Expected: PASS (the pre-existing "draining the explicit pool first" test still holds — it only asserts 6 unique names containing Vega/Altair).

- [ ] **Step 5: Commit**

```bash
git add src/conquest/names.ts src/conquest/names.test.ts
git commit -m "feat(conquest): extend exhausted star pools with roman numerals"
```

---

### Task 2: `limitToNamed` on the naming schema

**Files:**
- Modify: `src/conquest/names.ts` (`ConquestNames` line 27, `ResolvedNames` line 41, `mergeConquestNames` line 250, `resolveConquestNames` line 272)
- Test: `src/conquest/names.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `mergeConquestNames` describe block:

```ts
  it("carries limitToNamed profile-over-branding", () => {
    expect(
      mergeConquestNames({ limitToNamed: true }, {})?.limitToNamed,
    ).toBe(true);
    expect(
      mergeConquestNames({}, { limitToNamed: true })?.limitToNamed,
    ).toBe(true);
    // Profile explicitly off wins over branding on.
    expect(
      mergeConquestNames({ limitToNamed: false }, { limitToNamed: true })
        ?.limitToNamed,
    ).toBe(false);
  });
```

Add to the `resolveConquestNames` describe block:

```ts
  it("surfaces limitToNamed, defaulting to false", () => {
    expect(resolveConquestNames().limitToNamed).toBe(false);
    expect(
      resolveConquestNames({ limitToNamed: true }).limitToNamed,
    ).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/conquest/names.test.ts` Expected: FAIL — `limitToNamed` is not a known property.

- [ ] **Step 3: Implement**

In `ConquestNames` (after the `factions` field, line 37):

```ts
  /** Cap the galaxy to the named-star count and disable name fallback. */
  limitToNamed?: boolean;
```

In `ResolvedNames` (after `factions`, line 46):

```ts
  limitToNamed: boolean;
```

In `mergeConquestNames`, add to the `merged` object (after `factions`, line 260) — note this uses `??` not `firstNonEmpty` since it's a boolean:

```ts
    limitToNamed: profile?.limitToNamed ?? branding?.limitToNamed,
```

The existing `Object.values(merged).some((v) => v !== undefined)` guard already accounts for the new field.

In `resolveConquestNames` return (after `factions`, line 278):

```ts
    limitToNamed: names?.limitToNamed ?? false,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test src/conquest/names.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conquest/names.ts src/conquest/names.test.ts
git commit -m "feat(conquest): limitToNamed flag on the naming schema"
```

---

### Task 3: Apply the cap in the generator

**Files:**
- Modify: `src/conquest/generate.ts` (`generateGalaxy`, the `nodeCount`/`names` lines ~289-292)
- Test: `src/conquest/generate.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `generateGalaxy` describe block in `src/conquest/generate.test.ts`:

```ts
  it("caps node count to the named pool when limitToNamed is set", () => {
    const starNames = Array.from({ length: 20 }, (_, i) => `Star ${i}`);
    const doc = generateGalaxy(
      { ...base, nodeCount: 60, names: { starNames, limitToNamed: true } },
      "t0",
    );
    expect(doc.nodes).toHaveLength(20);
    expect(doc.generated?.nodeCount).toBe(20);
    // Every star has a unique base name — no numeral/synthesized fallback.
    const namesOut = doc.nodes.map((n) => n.name);
    expect(new Set(namesOut).size).toBe(20);
    for (const n of namesOut) expect(starNames.includes(n)).toBe(true);
  });

  it("leaves node count alone when the pool is larger than the request", () => {
    const starNames = Array.from({ length: 40 }, (_, i) => `Star ${i}`);
    const doc = generateGalaxy(
      { ...base, nodeCount: 16, names: { starNames, limitToNamed: true } },
      "t0",
    );
    expect(doc.nodes).toHaveLength(16);
  });

  it("floors a tiny capped pool at the generator minimum", () => {
    const doc = generateGalaxy(
      { ...base, nodeCount: 40, names: { starNames: ["Solo"], limitToNamed: true } },
      "t0",
    );
    expect(doc.nodes).toHaveLength(8);
  });

  it("ignores limitToNamed when unset (default overflow)", () => {
    const starNames = Array.from({ length: 12 }, (_, i) => `Star ${i}`);
    const doc = generateGalaxy(
      { ...base, nodeCount: 30, names: { starNames } },
      "t0",
    );
    expect(doc.nodes).toHaveLength(30);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/conquest/generate.test.ts` Expected: FAIL — first three tests get 60/16/40 (uncapped) or a type error until the cap exists.

- [ ] **Step 3: Implement**

In `src/conquest/generate.ts`, the head of `generateGalaxy` currently reads:

```ts
  const rng = mulberry32(opts.seed);
  const nodeCount = Math.min(80, Math.max(8, Math.round(opts.nodeCount)));
  const enemyCount = Math.min(3, Math.max(1, Math.round(opts.factionCount)));
  const names = resolveConquestNames(opts.names);
```

Reorder so `names` is resolved first, then derive the (possibly capped) count. Replace those four lines with:

```ts
  const rng = mulberry32(opts.seed);
  const enemyCount = Math.min(3, Math.max(1, Math.round(opts.factionCount)));
  const names = resolveConquestNames(opts.names);
  // limitToNamed caps the galaxy to the named-star pool (no fallback names);
  // the 8-node floor still applies, so pools smaller than 8 fill the few
  // extra names via the numeral fallback.
  const requested = Math.round(opts.nodeCount);
  const capped =
    names.limitToNamed && names.starNames.length > 0
      ? Math.min(requested, names.starNames.length)
      : requested;
  const nodeCount = Math.min(80, Math.max(8, capped));
```

(`nodeCount` is still `const` and used identically downstream, including in the `generated` block from PR A, so the capped value persists automatically.)

- [ ] **Step 4: Run the full conquest suite**

Run: `bun run test src/conquest` Expected: PASS — the cap tests plus every pre-existing generator test (determinism, round-trip, connectivity).

- [ ] **Step 5: Commit**

```bash
git add src/conquest/generate.ts src/conquest/generate.test.ts
git commit -m "feat(conquest): cap generated galaxies to the named-star pool"
```

---

### Task 4: Wizard caption when capped

**Files:**
- Modify: `src/conquest/pages/ConquestListPage.tsx` (`GenerateGalaxyForm`, the preview block added in PR A)

No unit test (derived JSX over Tauri hooks). Verified by typecheck and live smoke.

- [ ] **Step 1: Add the caption under the preview**

The PR A preview block reads:

```tsx
          {preview && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Preview</span>
              <GalaxyPreview2D galaxy={preview} />
            </div>
          )}
```

Replace it with a version that notes a cap when the realized galaxy is smaller than the requested size:

```tsx
          {preview && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Preview</span>
              <GalaxyPreview2D galaxy={preview} />
              {preview.nodes.length < Number(size) && (
                <span className="text-xs text-muted-foreground">
                  Capped at {preview.nodes.length} named systems.
                </span>
              )}
            </div>
          )}
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck && bunx biome ci src/conquest/pages/ConquestListPage.tsx` Expected: clean (0 errors; pre-existing warnings elsewhere are not this file).

- [ ] **Step 3: Commit**

```bash
git add src/conquest/pages/ConquestListPage.tsx
git commit -m "feat(conquest): note the named-star cap in the wizard preview"
```

---

### Task 5: Full verification + live smoke gate

- [ ] **Step 1: Full frontend suite**

Run: `bun run test && bunx biome ci . && bun run typecheck` Expected: all pass. Fix anything that fails before continuing.

- [ ] **Step 2: Rust suite (CI runs it even for frontend-only changes)**

Run: `cargo fmt --all --check && cargo clippy --all-targets --all-features -- -D warnings` If clippy fails on a missing sidecar/resource: `bun run sidecar:unitsync`, then `mkdir -p src-tauri/mapconv src-tauri/prdownloader`, and re-run. Expected: clean (no Rust touched).

- [ ] **Step 3: STOP — user live test**

Per project CLAUDE.md, offer `bun tauri dev` before any PR:
- A game whose catalog/profile sets a small `starNames` pool with `limitToNamed`: the wizard caps the galaxy and shows "Capped at N named systems"; regenerate keeps the cap.
- A large themed pool with an 80-system galaxy: overflow names read as "Name II"/"Name III", not invented syllables.
- No `limitToNamed`: default 80-system galaxy overflows the 50 real stars with "Altair II" etc.

Report status honestly (verified vs not). Then draft the PR description for user approval before `gh pr create`.
