# Map packs: banner + drawer with per-pack detail

## Problem

The Downloads → Maps page renders curated map packs as a grid of cards. Two issues:

1. **No visibility into pack contents.** A card shows the pack title, blurb and an `N / total downloaded` count, but never which maps are in the pack.
2. **Fully-downloaded packs still clutter the page.** A pack where every map is installed keeps its card (showing "All downloaded"), taking space above the browsable grid.

## Goal

Replace the inline card grid with a single banner that opens a right-hand drawer. The drawer lists the packs; selecting one shows a detail view listing that pack's maps with per-map download status and actions.

## Decisions (agreed)

- **Drawer nav:** two-level — pack list → pack detail (back button returns to the list).
- **Completed packs:** kept in the drawer with a "Complete" badge, but excluded from the banner's available count.
- **Per-map actions:** each map row shows install/queue status and an individual download button; the detail header also has "Download all".
- **Thumbnails:** shown where cheaply available (see Thumbnails), placeholder otherwise.

## Architecture

Three units, following existing patterns.

### 1. `src/downloads/mapLists.ts` — pure status helpers (extend existing file)

Currently holds `mergeMapLists` and `suggestedMapToInput`. Add pure, testable status logic so the banner count, list rows and detail rows share one source of truth (the status logic today is inlined in `MapPacks`):

```ts
export type PackMapState =
  | "installed"    // filename present on disk, or queue reports done
  | "active"       // currently downloading
  | "queued"       // waiting in the queue
  | "available"    // downloadable, not started
  | "unavailable"; // no queue input could be built (non-map download kind)

export function packMapState(args: {
  input: EnqueueInput | null;
  filename?: string;
  installed: Set<string>;        // lowercased filenames
  queueStatus: QueueStatus | null; // statusFor(identityOf(input))
}): PackMapState;

export interface PackSummary {
  total: number;
  done: number;      // installed
  pending: number;   // available (enqueueable now)
  inFlight: number;  // queued + active
  complete: boolean; // done === total
}
export function packSummary(states: PackMapState[]): PackSummary;
```

`QueueStatus` is the existing return type of `statusFor`. These functions take primitives only (no React), so `mapLists.test.ts` can cover every state and the summary counts.

### 2. `src/downloads/pages/components/MapPacksDrawer.tsx` — the drawer (new)

Built on the radix `Dialog` primitive styled as a right-hand sheet, mirroring `MapPickerDrawer.tsx` (the codebase ships no sheet component; this is the established convention). Self-contained: uses `useDownloadQueue()` internally for `enqueue` + `statusFor`.

Props:
```ts
{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packs: SuggestedMapList[];              // already merged
  writePath?: string;
  installed: Set<string>;                 // lowercased filenames
  thumbFor?: (map: SuggestedMap) => string | undefined;
}
```

Internal state: `selectedPackId: string | null`.

- **List view** (`selectedPackId === null`): one row per pack — title, blurb, `packSummary` progress (`done / total`), a "Complete" badge when `complete`, and a chevron. Clicking sets `selectedPackId`.
- **Detail view** (`selectedPackId` set): header with a back button + pack title + "Download all (N)" (enqueues every `available` map). Below, one row per map: thumbnail (or `ImageOff` placeholder), title, a status label derived from `packMapState`, and a per-map button — "Download" (available), "Queued"/"Downloading…" (disabled, in-flight), a check (installed). Download buttons are disabled when `writePath` is unset (same guard as today).

### 3. `src/downloads/pages/MapsPage.tsx` — banner replaces the grid

The existing `MapPacks` component becomes a **banner**: a full-width `Card` acting as a button (Layers icon, "Map packs" title, subtitle "N packs available" — the count of non-complete packs — and a chevron). It:
- merges catalog + profile packs (unchanged: `mergeMapLists(useSuggestedMapLists(), getProfileMapLists())`),
- holds the drawer `open` state,
- renders `<MapPacksDrawer>`,
- builds `thumbFor` (see below),
- returns `null` only when there are **no packs at all** (a pack set that's entirely complete still shows the banner so completed packs stay reviewable; subtitle becomes "All packs downloaded").

## Thumbnails

The Downloads page has no local minimap pipeline — the browse grid's thumbnails are remote preview URLs from the source APIs (BAR/springfiles), and the catalog packs carry no thumbnail URLs. So `thumbFor` resolves opportunistically, in order:

1. `map.thumb?.[0]` if the catalog entry provides one (none do today, but the field exists),
2. a thumbnail from the **currently-loaded browse `items`** matched by lowercased filename (free when the pack map is in the selected source's list),
3. otherwise `undefined` → placeholder icon.

**Coverage is therefore partial and source-dependent** (e.g. BAR source populates thumbs for BAR-known maps). This is honest to the "where available" decision and adds no new network calls. If fuller coverage is wanted later, the follow-up is adding `thumb` URLs to the catalog pack entries — out of scope here.

## Data flow

MapsPage already tracks `installed` (via `dlInstalledContent`) and refreshes it on `useDownloadComplete`. The drawer reads `installed` as a prop, so a completed download flips a map's row to installed and updates `packSummary` live without a reload. `writePath` comes from `useWriteRootPath` as today.

## Error / empty states

- No packs defined → no banner (unchanged behaviour).
- `writePath` unset → all download buttons disabled (unchanged guard).
- Missing thumbnail → placeholder icon, never a broken image.
- A pack map whose download kind yields no queue input (`unavailable`) → row shown, button disabled. (All current packs are `kind:"map"`, so this is a safety branch.)

## Testing

- **Unit** (`src/downloads/mapLists.test.ts`): extend with cases for `packMapState` (each of the five states from representative inputs) and `packSummary` (mixed states → correct `done/pending/inFlight/total/complete`).
- **Static:** `bunx biome ci .`, `bun run typecheck`.
- **Live smoke** (`bun tauri dev`): banner shows correct available count; opening the drawer lists packs; a complete pack shows the badge and is excluded from the count; selecting a pack lists its maps with correct statuses; per-map and "Download all" both enqueue; a finished download flips the row and count live. No component test harness exists for the existing drawers, so the drawer UI is verified by live smoke, not unit tests.

## Out of scope

- Adding thumbnail URLs to catalog pack entries (future enrichment).
- Any change to the browsable map grid, sources, or the hide-downloaded toggle.
- Changes to how packs are downloaded (still the shared download queue via `suggestedMapToInput`).
