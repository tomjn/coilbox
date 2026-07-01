# Game detail header image (loadpicture hero banner)

## Problem

The Game detail page (`src/content/pages/GameDetailPage.tsx`) is a plain text
header: name, version, description, a metadata table. Games ship loading-screen
art in their archive that the engine uses as loading backgrounds, but coilbox
shows none of it. We want a Steam-library-style hero banner at the top of the
page for visual identity, reusing that loading art since dedicated per-game
branding doesn't exist. The resolved image should be cached durably so it is
instant to load and reusable elsewhere (e.g. a games-grid hero, the launcher).

## Sources of art (in priority order)

Spring/Recoil games expose loading art two ways:

1. **`modinfo.lua` `loadpicture` field** - a single designated image, surfaced as
   `game.info.loadpicture` (a slash-separated path within the primary archive).
   The game author's deliberate choice, so it is used **first**.
2. **`bitmaps/loadpictures/` folder** - a directory of images the engine samples
   at random on load. Used as a **fallback** when `loadpicture` is unset or fails.

If neither yields a usable image, the banner shows a generated colored gradient
(see Rendering) so **every game has a hero** - there is no art-less code path that
regresses to the old plain header.

## Baseline

Build on `origin/main` (`e61f759` "feat(content): add Play button to game
detail"), which added a **Play** button to the header title row. This worktree is
on a detached HEAD one merge behind, so the implementation branch must be based on
`origin/main` to include that button.

## Architecture

Two layers: a new Rust command that resolves + persistently caches the image, and
a frontend `GameHeader` component that renders the hero.

### Rust: resolve + disk cache (new command)

New command `unitsync_game_header` in `tauri-plugin-coilbox-unitsync`, backed by
resolution logic in `coilbox-unitsync-worker/src/archive.rs`.

```
unitsync_game_header({ enginePath, dataDir, archive, checksum, loadpicture? })
  -> GameHeaderResult { dataUrl?: string, source: "loadpicture" | "folder" | "none", cached: boolean }
```

Cache directory: `app.path().app_cache_dir()/game-headers/` (sibling of the
existing thumbnail cache; see `thumb_cache_dir()` in the plugin's `lib.rs`).

Cache key: `game.checksum` (unique per installed game; changes when archive
content changes, giving free invalidation). If `checksum` is empty, fall back to a
hash of the archive name.

Lookup / resolve flow:

1. **Positive hit** - `game-headers/<checksum>.png` exists: read it, return its
   bytes as a PNG `data:` URL with `cached: true`. No archive open. `touch` its
   mtime for LRU.
2. **Negative hit** - `game-headers/<checksum>.none` marker exists: return
   `{ source: "none", cached: true }`. No archive open.
3. **Miss** - open the archive's VFS once and resolve a candidate:
   - `loadpicture` first (if the passed path is non-empty and reads as an image).
   - else list members under `bitmaps/loadpictures/` (case-insensitive prefix)
     ending in `.jpg/.jpeg/.png/.tga/.bmp` and pick one at random.
   On success: transcode to PNG (reuse the `encode_preview_image` path in
   `archive.rs`, factored so it can emit PNG bytes for the disk write as well as
   the `data:` URL for the response), write `<checksum>.png`, return the `data:`
   URL with `source` set and `cached: false`. On no candidate: write the
   `<checksum>.none` marker and return `source: "none"`.

Because the chosen file is frozen on disk as `<checksum>.png`, the random folder
pick is **stable across launches** until the archive (hence checksum) changes.

Eviction: after a write, enumerate `game-headers/`, sum sizes, and if over a cap
(**default 128 MB**), delete entries oldest-first by mtime until under budget.
`.none` markers are tiny and exempt. Simple size-based LRU, no index file.

ACL: the new command needs its entry in the plugin `build.rs` `COMMANDS` list and
`permissions/default.toml`, or it is blocked at runtime.

### Frontend: shared hook + component

- Binding `unitsyncGameHeader` + `GameHeaderResult` type in
  `src/content/bindings.ts`.
- Hook `useGameHeaderImage(enginePath, dataDir, archive, checksum, loadpicture)`
  in `src/content/config.ts`, following the existing
  `useUnitsyncArchiveFile`/`useUnitsyncArchiveTree` shape: a module-level
  `Map<checksum, GameHeaderResult>` session cache over the Rust command, no-ops
  when `archive`/`checksum` is undefined. This is the reuse point - any component
  (detail hero, future grid, launcher) calls the hook and shares the cache.
- Component `src/content/pages/components/GameHeader.tsx`:
  `GameHeader({ game, selected, onPlay })`. `GameDetailPage` replaces its current
  `<header>` block with `<GameHeader … />`, passing its existing `play` handler.
  Everything below the header is unchanged; `shortname`, `checksum`, and
  `description` continue to render below the banner.

Two-tier cache overall: Rust disk cache (cross-launch, keyed by checksum) +
frontend module `Map` (within-session, avoids re-invoking the command per mount).

## Rendering

Full-bleed Steam-style hero, always present:

- Container breaks out of the page's `p-4` with `-mx-4 -mt-4`, `h-48` (192px),
  `w-full`, `relative`, `overflow-hidden`.
- **Base layer (always):** a colored gradient placeholder. Two hues derived from a
  hash of `game.name` produce a diagonal `linear-gradient` (inline style, dark-ish
  so overlaid white text stays AA-legible). Shown immediately and whenever
  `source === "none"`.
- **Art layer (when `dataUrl` present):** `<img>` absolutely filling the
  container, `object-cover object-center` so the full-screen source art crops to a
  wide, short strip (center-anchored - top/bottom trimmed, matching Steam).
  `alt={`${game.name} loading screen`}`. Fades in over the placeholder on load;
  the fade is wrapped in `@media (prefers-reduced-motion: reduce)` to disable it.
- **Scrim:** an absolutely-positioned `bg-gradient-to-t from-background` overlay
  fading the image into the page background along the bottom, guaranteeing
  contrast for the overlaid controls.
- **Back-link:** "← Games" floats top-left over the image with a small dark scrim
  behind it for AA contrast.
- **Title + version:** bottom-left overlay - `h1` game name (with `SddBadge` when
  applicable) and version, white with a text-shadow.
- **Play button:** bottom-right overlay, the primary CTA (same `Play` icon +
  `onPlay` handler moved from the merged header). `shrink-0`.

All spacing on the 8pt/4pt grid. Touch targets >= 24px.

## Behaviour notes

- No skeleton: the placeholder is the base layer, so there is never a blank banner
  and no layout shift; real art fades in when/if it arrives.
- Broken/missing `loadpicture` silently falls back to a folder image, then to the
  placeholder - no error surfaced to the user.
- Selection/engine not chosen (`selected` undefined): hook no-ops, placeholder
  hero renders with title + Play.

## Success criteria

- A game with a `loadpicture` shows that image cropped into the 192px banner with
  title + version + Play overlaid.
- A game with no `loadpicture` but `bitmaps/loadpictures/*` shows one of those
  images, stable across navigation and across relaunches (frozen on disk).
- A game with neither shows a gradient placeholder hero (never the old plain
  header, never a blank strip), and does not re-open its archive on later launches
  (negative cache marker).
- Second launch renders cached heroes without opening the archive VFS
  (`cached: true`).
- Cache stays under the size cap via oldest-first eviction.
- The Play button retains its exact merged behaviour (seeds skirmish draft, routes
  to `/play/skirmish`).
- Lint/type/build green with the same commands CI runs:
  `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D
  warnings`, `bunx biome ci .`, `bun run typecheck`.
- Verified live via `bun tauri dev` + Tauri MCP screenshots of: a game with
  loadpicture art, a game showing the placeholder, and a relaunch hitting the
  cache.
