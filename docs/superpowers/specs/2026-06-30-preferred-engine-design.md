# Preferred Engine — Design

Date: 2026-06-30

## Problem

The app discovers multiple engine installs across content roots, but there is no
single "this is the engine to use" choice. Unitsync scanning currently defaults
to the *first discovered* engine (`useScanTargetSelection` → `targets[0]`), and
any future battle-launching would face the same ambiguity. We want the user to
pick a preferred engine, defaulting to the newest version available.

## Scope (decided)

- **Global default that feeds `scanTarget`.** One global "preferred engine"
  setting becomes the default for the existing per-page scan target. The
  per-page `TargetPicker` still works as a session override.
- **Newest = parsed version comparison.** When no preferred engine is set, the
  default is the highest-versioned engine, by a best-effort numeric parse.
- **Explicit pick always wins.** Once the user chooses, we never auto-change the
  pick even if a newer engine is later installed.
- **UI: star/badge on engine rows.** The Engines page is where the choice is
  made and shown.

## Out of scope

- No Rust changes — the preference is pure frontend settings state. The engine
  records themselves continue to live in the plugin's `state.json`.
- No battle launcher (none exists yet). This only makes the engine unambiguous
  for when it is built; that code will read the same setting / resolved engine.
- No auto re-pick when a newer engine appears after an explicit choice.
- No JS unit tests in this change: the repo has no frontend test harness
  (no vitest/test script), and adding one is a separate, opt-in decision.
  `engineVersion.ts` is written as a pure, isolated module so tests can be added
  later without restructuring.

## Components

### 1. New setting

`content.preferredEngineId` — `string`, default `""`, via the existing
`useSetting` store (same mechanism as `content.scanTarget`). Stores a bare
`engine.id`. `engine.id` is a hash of `(rootPath, enginePath)` and so is globally
unique across roots, which makes both the badge match and the scan-target
derivation trivial.

### 2. Version comparison — `src/content/engineVersion.ts` (new, pure module)

- `compareEngineVersions(a: string, b: string): number`
  - Parses the leading dotted numeric components (e.g. `105.1.1`) plus BAR's
    commit-count suffix (the integer in `-2511-g…`).
  - Compares numerically component-by-component, then by commit count.
  - Falls back to `localeCompare` when a string has no parseable leading number.
- `newestEngineId(engines: { id: string; version: string; syncVersion?: string }[]): string | undefined`
  - Returns the `id` of the max engine by
    `compareEngineVersions(syncVersion ?? version)`, using array order as a
    stable tiebreak. `undefined` for an empty list.

Version strings handled: `105.1.1-2511-gabc1234 bar`, legacy `104.0.1-1828-g…`,
plain `104.0`, and arbitrary folder names (lexical fallback).

### 3. Resolution hook — `usePreferredEngine` in `src/content/config.ts`

```
usePreferredEngine(state: ContentState | null): {
  prefId: string;                 // raw persisted setting ("" if unset)
  resolvedId: string | undefined; // prefId if it matches a live engine, else newestEngineId(all)
  setPrefId: (id: string) => void;
}
```

- Flattens `state.roots[].engines` to one list.
- `resolvedId = engines.find(e => e.id === prefId)?.id ?? newestEngineId(engines)`.
- Everything consumes `resolvedId`, so a deleted engine transparently falls back
  to newest and a reappearing one is re-honored without clearing the setting.

### 4. Wire into the scan-target default

In `useScanTargetSelection`, change the fallback chain from
`persisted → targets[0]` to `persisted → resolved-preferred → targets[0]`:

```
selected = targets.find(t => targetKey(t) === selectedKey)
        ?? targets.find(t => t.engineId === resolvedId)
        ?? targets[0]
        ?? null
```

The per-page `TargetPicker` override (an explicit `selectedKey`) is unchanged.

### 5. UI — badge + action on engine rows

- `EngineRow` gains props `isPreferred: boolean` and
  `onSetPreferred: (engine: Engine) => void`.
  - When `isPreferred`: a "Preferred" `StatusBadge` (tone `good`, star icon) next
    to the version.
  - Otherwise: a "Set preferred" button (star icon, `outline`/`sm`, matching the
    existing Verify/Open buttons) in the actions group.
- `EnginesSection` computes `resolvedId` once via `usePreferredEngine(state)` and
  passes `isPreferred={engine.id === resolvedId}` and an `onSetPreferred` that
  calls `setPrefId(engine.id)`. Because the default is the resolved newest, the
  newest engine shows the badge immediately, before any explicit pick.

## Data flow

```
state.roots[].engines
  → newestEngineId(...)              (when no explicit pick)
  → resolvedId
      ├─ EngineRow badge   (engine.id === resolvedId)
      ├─ scanTarget default (target whose engineId === resolvedId)
      └─ future battle launch (reads content.preferredEngineId / resolvedId)
```

## Verification

- `bun run typecheck`
- `bunx biome ci .`
- Manual smoke: with ≥2 engines of differing versions, confirm the newest shows
  the "Preferred" badge by default; clicking "Set preferred" on another moves the
  badge and changes the Maps/Games default target; the choice persists across an
  app restart; removing the preferred engine falls back to newest.
