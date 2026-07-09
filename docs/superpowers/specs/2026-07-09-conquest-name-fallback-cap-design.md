# Conquest star-name fallback + named-count cap (PR B)

Date: 2026-07-09
Status: approved

## Problem

Two related gaps in conquest naming (`src/conquest/names.ts`), surfaced when a branding catalog ships a themed star-name pool smaller than the galaxy the player wants:

1. **Off-theme overflow.** `makeStarNamer` drains the `starNames` pool, then synthesizes pronounceable names from syllable pools (`STAR_FIRST`/`STAR_LAST`). A catalog with 50 lore names and an 80-system galaxy yields 50 themed names followed by 30 invented ones that clash with the theme.
2. **No way to cap.** A distribution that wants a fixed, fully-curated galaxy has no way to say "never invent names — cap the galaxy to the names I gave you."

## Design

### 1. Themed numeral fallback

`makeStarNamer` (`names.ts:288`) gains a tier between the unique-pool pass and syllable synthesis: once the shuffled pool drains, cycle it with roman numerals — `Vega II`, `Altair II`, ... `Vega III` — drawn in pool order per numeral. Because numerals never run out, syllable synthesis is reached only when the pool is empty (which `resolveConquestNames` prevents for real inputs, so synthesis becomes the empty-pool safety net). A small `toRoman(n)` helper (n >= 2) covers arbitrarily deep overflow.

Behaviour change: default galaxies (the built-in 50 real-star pool) past 50 systems now read `Altair II` instead of invented syllables. Accepted as an improvement.

### 2. `limitToNamed` cap

- New optional `limitToNamed?: boolean` on `ConquestNames` (`names.ts:27`), merged profile-over-branding in `mergeConquestNames` and surfaced on `ResolvedNames`.
- `generateGalaxy` reads the resolved flag: when set and the resolved `starNames` pool is non-empty, cap `nodeCount` to the pool size before the existing 8..80 clamp. So a pool of 30 with a requested 80 yields exactly 30 unique-named systems and zero fallback.
- Floor: the generator's 8-node minimum still applies. Pools of 8+ are capped exactly (zero fallback); pools smaller than 8 floor at 8 and the numeral fallback fills the few extra names. Documented limitation — tiny curated galaxies are out of scope.
- The capped count flows through PR A's persisted `generated.nodeCount`, so the wizard preview and in-place reroll reflect the cap automatically.

### 3. Wizard caption

In `GenerateGalaxyForm`, when the live preview has fewer systems than the selected size, show a small caption under the preview: `Capped at N named systems.` Purely derived from `preview.nodes.length` vs the selected `size`; no new state.

## Data flow

`profile.json` / catalog `conquest.limitToNamed` -> `mergeConquestNames` -> `generateGalaxy(opts.names)` -> `resolveConquestNames` -> cap applied to `nodeCount` -> persisted in `generated.nodeCount`. Naming tier order lives entirely in `makeStarNamer`.

## Testing

- Unit (`names.test.ts`): numeral fallback produces `Name II`/`Name III` in pool order, stays unique, and never reaches synthesis while the pool is non-empty; `toRoman` spot values; `mergeConquestNames` carries `limitToNamed` profile-over-branding.
- Unit (`generate.test.ts`): `limitToNamed` caps node count to pool size (pool >= 8), leaves count unchanged when unset or pool larger than request, floors at 8 for tiny pools, and the capped count lands in `generated.nodeCount`.
- Live: catalog/profile with `limitToNamed` and a small pool caps the wizard galaxy with the caption; a large themed pool overflows with numerals not syllables. Verified in `bun tauri dev` before PR.

## Out of scope

voidwater asteroid/comet node kinds (PR C); predefined stars with presets (PR D). No catalog.json data changes in this PR — the schema is additive and opt-in; authoring a `limitToNamed` entry is a follow-up.
